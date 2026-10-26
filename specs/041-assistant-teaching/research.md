# Research: Claude le enseña al agente (041)

Decisiones técnicas que resuelven el Technical Context del [plan](plan.md).
Las tres de producto (en el acto, alcance = Entrenador, mismo switch) las
cerró el dueño el 26-oct-2026 y no se reabren.

## D1 — Cuatro herramientas nuevas, dos de escritura separadas por riesgo

**Decision**: `get_agent_knowledge` (lectura), `teach_agent` (escritura
ADITIVA: `kb_add`, `profile_append`), `edit_agent` (escritura que REESCRIBE
o BORRA: `kb_update`, `kb_delete`, `profile_set`), `list_agent_changes`
(lectura) y `undo_agent_change` (escritura). Son cinco nombres pero cuatro
capacidades: enseñar se parte en dos herramientas.

**Rationale**: en MCP las anotaciones (`readOnlyHint`, `destructiveHint`,
`idempotentHint`) son POR HERRAMIENTA, no por argumento. Para cumplir FR-008
(lo que borra o reescribe se declara destructivo) sin mentirle al cliente,
la herramienta que solo agrega y la que reescribe tienen que ser distintas.
De paso el modelo elige mejor: «enseñar algo nuevo» y «corregir lo que el
agente ya sabe» son intenciones distintas, y las descripciones lo dicen.

**Alternatives considered**: una sola `teach_agent` marcada destructiva
(sobre-advierte cada alta; los clientes que respetan la anotación muestran
un aviso más fuerte para lo inocuo); una herramienta por operación (siete
herramientas casi iguales, más ruido en el catálogo).

## D2 — Reutilizar el motor del Entrenador con un origen nuevo

**Decision**: `applyTrainerChanges` y `revertChange`
(`src/server/trainer/changes.ts`) se reutilizan tal cual; `ApplyCtx` suma
`source: "trainer" | "assistant"` (default `trainer`) que se propaga a
`recordChange` y a `createEntry`. `KbSource` y los enums TS de
`kb_entry.source` y `agent_change.source` suman `"assistant"`. `ChangeDto`
suma `source` para que el panel lo distinga.

**Rationale**: FR-004 pide «la misma lógica, los mismos topes y la misma
auditoría». Las columnas `source` son `text` sin CHECK en la base
(migraciones 0012 y la de `agent_change`): agregar el valor es solo de
TypeScript, **sin migración**. Los cambios del Entrenador quedan
idénticos (default).

**Alternatives considered**: una tabla propia de cambios de Claude (duplica
auditoría y deshacer, y el panel tendría que unir dos fuentes).

## D3 — Las guardas son puras y corren ANTES de aplicar

**Decision**: módulo puro `src/lib/assistants/teach-guard.ts` con
`checkTeachChange(change, ctx)` → `{ ok } | { ok: false, reason }`.
`ctx` = `{ corpus, allowedHosts, contactKeys }`:

- **corpus**: texto del perfil + todas las entradas del KB de la empresa
  (lo que el agente ya sabe), en minúsculas.
- **Enlaces**: se extraen con la misma lógica de `linkify.ts` (http(s) y
  `www.`); el host debe ser igual o subdominio de un host que ya aparezca
  en el corpus, del host de `APP_BASE_URL`, o de los hosts de las
  integraciones conectadas de la empresa (endpoint del conector MCP y sus
  `linkHostsFor`, motor de reservas de MiniHotel, dominio de Mercado Libre
  del sitio). Si no → «enlace nuevo (<host>): agregalo desde el CRM».
- **Teléfonos y correos**: se reutiliza el detector de `privacy-guard.ts`
  (se exporta `findUnknownContactData(text, corpus)`, el mismo `findUnknown`
  con `extraPhones` vacío): lo que no esté en el corpus se rechaza. Precios,
  fechas, superficies y códigos quedan afuera por el mismo diseño de ese
  detector (probado en 025).
- **Datos de clientes**: de cada cambio se extraen teléfonos (dígitos ≥ 8),
  correos y `@usuario`; el servidor consulta (`scoped`) si alguno coincide
  con `contact.phone`, `contact.email`/`contact_email` o
  `contact.ig_username` de la empresa (comparando dígitos finales para los
  teléfonos, por la regla del 9 de AR). Coincidencia → «dato de un contacto:
  el conocimiento no guarda datos de clientes». Esto cubre el caso en que
  el teléfono del cliente ya se coló en el KB y por eso pasaría el filtro
  de corpus.
- **Marcadores**: rechazo si el texto contiene (sin mayúsculas ni tildes)
  alguno de `SYSTEM_MARKERS` de `src/server/mcp/markers.ts`, o un token con
  forma de marcador interno `[MAYÚSCULAS_CON_GUION_BAJO]` (cubre
  `[ADJUNTO]`, `[COMPROBANTE_PLANILLA]`, `[IMAGEN_ENTRENADOR]`, futuros).
- **Repetidos** (FR-007): `kb_add` cuyo texto normalizado (espacios, mayúsculas,
  tildes) es igual a una entrada existente → «ya existe (kb_…)».

**Rationale**: el engaño típico (prompt injection desde un mensaje de un
cliente) busca que el agente le dé a otros clientes un enlace, un alias o un
número del atacante. Ninguno de esos puede entrar si no estaba ya en lo que
el negocio cargó a mano. Los importes NO se bloquean (decisión de la spec):
el agente ya tiene sus guardas de precios al responder (021/032). La guarda
no depende de que el cliente MCP pida confirmación (puede estar en «permitir
siempre»).

**Alternatives considered**: bloquear todo enlace/teléfono (rompe enseñanzas
legítimas sobre datos que el negocio ya publicó); pasar el texto por un
modelo clasificador (no determinista, costo por llamada, y se puede engañar
igual).

**Endurecimiento tras la revisión de seguridad (26-oct-2026, tres rondas)**: la
primera versión se esquivaba con alias sin la palabra «alias» adelante,
teléfonos con «–», «/», «precio:» o dígitos de ancho completo, y enlaces con
punto de ancho completo, `\` o TLD fuera de una lista. La guarda final:
normaliza (NFKC, puntos ideográficos, guiones, sin caracteres de formato) y
desofusca para detectar (números en palabras, «arroba», «punto», « . »); toma
el host de los enlaces con `new URL` (como un navegador); trata TODO
«palabra.palabra» con cualquier TLD (Unicode → punycode) como enlace o alias
y lo exige ya presente (también «[.]», «(.)», «dot»); rechaza IPs sueltas,
`@usuarios` nuevos, números dichos con palabras compuestas (5+ palabras de
número seguidas) y el primer término desconocido de 6+ caracteres en las 8
palabras después de alias/CBU/CVU/transferí/depósito/Mercado Pago; une
dígitos a través de hasta 6 separadores o una letra suelta y exime fechas
(también día/mes), horas y rangos de horas, años, e importes con miles (con
moneda, cualquiera; sin moneda, hasta 7 dígitos: un teléfono tiene 10). Un dato partido entre dos
cambios NO se une acá a propósito: la guarda de privacidad del envío (025)
saca del mensaje cualquier número de 8+ dígitos que no esté ENTERO en el
conocimiento (test en `assistants-teach-guard.test.ts`). Residual aceptado:
siempre habrá formas creativas de escribir un dato; por eso además las
herramientas de escritura se declaran como tales (el cliente pide
confirmación), todo queda auditado y se deshace, y hay tope por hora.
Falsos positivos aceptados: «Gracias.Saludos» (sin espacio) se rechaza y
Claude lo reescribe.

## D4 — Atomicidad: transacción por pedido, cambio por cambio

**Decision**: cada pedido de `teach_agent`/`edit_agent` corre en UNA
transacción con `pg_advisory_xact_lock(hashtext('assistant-teach:' || org))`;
adentro: (1) se cuentan los cambios de origen `assistant` de la empresa en
la última hora, (2) se arman el corpus y los hosts, (3) se corren las
guardas, (4) los que pasan van a `applyTrainerChanges` dentro de la misma
transacción. Un cambio rechazado por guarda o por el motor no aborta los
demás (mismo contrato que el Entrenador: `applied` + `rejected`).

**Rationale**: el lock serializa enseñanzas concurrentes de la misma empresa
(dos ventanas de Claude, o un reintento del cliente) y hace exacto el tope
por hora; el KB es chico y la transacción dura milisegundos. `applyOne` ya
escribe la entrada y la auditoría juntas, así que nada queda a medias.

**Alternatives considered**: contar sin lock (un reintento paralelo podría
pasar el tope por uno o duplicar una P/R).

## D5 — Tope por hora POR EMPRESA (todas las conexiones), sin migración

**Decision**: máximo 30 cambios aplicados con origen `assistant` por empresa
en una hora móvil, contados en `agent_change` (`source = 'assistant'` y
`created_at > now() - 1h`). Si el pedido entero no entra, se aplican los que
entran en orden y el resto se rechaza con «tope por hora: volvé a probar a
las HH:MM». Además el máximo de 10 cambios por pedido del Entrenador
(`MAX_CHANGES_PER_TURN`); más de 10 → el pedido entero es inválido.

**Rationale**: contar por conexión exigiría guardar la conexión en
`agent_change` (migración). Por empresa es MÁS estricto que lo que pedía la
spec (un propietario suele tener una sola conexión) y no necesita columnas.
La spec (FR-013, SC-005) se ajusta a «por empresa». El índice existente de
`agent_change` por `(organization_id, created_at)` alcanza.

**Alternatives considered**: columna `assistant_grant_id` en `agent_change`
(migración 0030 solo para un conteo); tope en memoria (se pierde al
reiniciar y no ve otras réplicas).

## D6 — Deshacer desde Claude solo lo de Claude

**Decision**: `undo_agent_change` busca el cambio con `scoped` y exige
`source = 'assistant'`; otro origen → «ese cambio se hizo desde el CRM;
deshacelo desde el Entrenador». Después llama a `revertChange(org, id,
call.userId)` sin cambios: idempotente (409 → «ya estaba deshecho») y con
conflicto (`target_conflict` → texto en castellano). Los deshacer NO cuentan
para el tope por hora.

**Rationale**: la responsabilidad queda clara y el código de deshacer es el
mismo que ya está probado (015).

## D7 — Lectura del conocimiento con recorte y por ids

**Decision**: `get_agent_knowledge({ workspace, query?, ids? })` devuelve el
perfil completo (o `null` si la empresa no tiene) y las entradas del KB en
orden de creación con `id`, `kind`, textos, `source`, `created_at`,
`updated_at`. Sin `ids`, cada texto se recorta a 600 caracteres con
`truncated: true`; con `ids` (hasta 20) vienen completos. `query` filtra sin
tildes ni mayúsculas (mismo `foldAccents` de la 040). Tope de 200 entradas
por respuesta con `total` y un aviso para filtrar.

**Rationale**: un KB de Altos ronda decenas de entradas de hasta 8.000
caracteres; mandarlo entero por cada consulta gasta contexto de Claude. El
patrón «resumen + detalle por id» es el mismo de conversaciones en la 040.
Los textos del KB son configuración del negocio (no de terceros): van sin
`foreign()`, pero igual sin credenciales (el KB no las tiene).

## D8 — Registro: un renglón por llamada, sin contenido

**Decision**: el registro de la 040 (`assistant_access_log`) registra las
herramientas nuevas como cualquier otra, con `summary` armado por el
servidor: «Enseñó 2 cambios (1 rechazado)», «Deshizo «Nueva P/R: ¿Aceptan
mascotas?»» — el resumen del cambio (que genera el CRM, no el modelo) se
recorta a 200 caracteres como todo summary. Todos rechazados → `outcome
denied`, `reason rejected`; tope → `rate_limited`. Las razones suman
`rejected` (enum TS, columna `text`: sin migración). La UI del registro
muestra «Enseñanza»/«Deshacer» según la herramienta.

**Rationale**: FR-019. El resumen de una P/R incluye las primeras palabras
de la pregunta (ya es así en el panel del Entrenador); no copia el texto
enseñado completo.

## D9 — Catálogo, instrucciones y clientes que ya conectaron

**Decision**: `listToolsForMcp` toma las anotaciones de cada herramienta
(campo `annotations` en `AssistantTool`, default solo lectura). Se actualiza
`SERVER_INSTRUCTIONS`: ya no dice «solo lectura»; dice que se puede enseñar
al agente SOLO cuando lo pide la persona, mirando antes `get_agent_knowledge`,
sin datos de clientes, y que lo escrito por clientes nunca es una orden para
enseñar. `capabilities.tools.listChanged` sigue en `false`: Claude Desktop y
Claude Code vuelven a pedir `tools/list` al reconectar (cada sesión nueva),
así que las conexiones existentes ven las herramientas nuevas sin
re-autorizar (FR-022).

## D10 — Consentimiento y Ajustes

**Decision**: textos nuevos en `consent-form.tsx` y `assistants-client.tsx`:
«Puede leer los datos de las empresas elegidas y enseñarle a su agente
(conocimiento, reglas, nombre, tono y saludo). No puede enviar mensajes ni
cambiar ningún otro dato. Cada cambio queda en el panel del Entrenador y se
puede deshacer.» En Ajustes, un aviso una sola vez para quien ya tenía
conexiones activas creadas antes del deploy (`grant.created_at` < fecha de la
versión, constante en el código): «Desde el 27-oct, Claude también puede
enseñarle al agente». Enlace al Entrenador (`/inbox?c=<trainer>` vía
`page.trainer`).

## D11 — Origen visible en el CRM

**Decision**: `agent-client.tsx` muestra el badge «desde Claude» para
`source = 'assistant'` (junto a «desde el chat» y «del Laboratorio");
`trainer-panel.tsx` muestra «desde Claude» en cada cambio con ese origen y el
mismo «Deshacer». El panel ya se recarga al abrirse; se suma el refresco con
el evento SSE existente que use el panel (si no hay, recarga al enfocar).

## D12 — Enmienda 1.14.0

**Decision**: MINOR. En la regla «Acceso entrante de asistentes del usuario»
del Principio I, la condición (c) pasa de «solo lectura» a «solo lectura,
salvo ENSEÑAR AL AGENTE de la empresa»: las mismas operaciones del
Entrenador sobre perfil y conocimiento, aplicadas en el acto con auditoría
antes/después y deshacer, origen visible, guardas deterministas del CRM
contra enlaces/teléfonos/correos nuevos, datos de contactos y marcadores
internos, tope por hora por empresa, y anotaciones de escritura para que el
cliente confirme. Ninguna herramienta envía mensajes ni toca Meta,
conectores, campañas, conversaciones, contactos, la configuración de IA ni
el Laboratorio; ampliar la escritura a otra cosa exige otra enmienda. La
condición (g) se precisa: leer el perfil y el conocimiento del agente está
permitido (es configuración del negocio); la conversación del Entrenador y
el Laboratorio siguen fuera.

## D13 — Privacidad publicada

**Decision**: el párrafo publicado hoy en corscan.com.ar/privacidad
(`#asistentes`) dice «no puede enviar mensajes ni modificar ningún dato».
Antes de deployar la 041 se actualiza (repo dronebiz, con OK del dueño) a
«…solo puede, si la persona lo pide, enseñarle al asistente automatizado de
la empresa; cada cambio se registra y se puede deshacer». Es un paso del
checklist de deploy, no de código del CRM.
