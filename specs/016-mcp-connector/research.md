# Research — 016 Conector MCP por empresa (PMS del cliente)

Cada decisión se tomó contra el código del repo o contra el servidor MCP real
(probado con credencial el 21-sep-2026; fixtures en la carpeta de trabajo de la
feature). Donde una alternativa se descartó, el motivo está escrito: es lo que
el Principio VII pide para no re-litigar la decisión dentro de seis meses.

## D1 — Constitución: un servidor MCP de un tercero no encajaba en ninguna categoría

**Decisión**: enmienda MINOR 1.6.0 → 1.7.0. El Principio II gana una **quinta
categoría**: *servidores MCP de terceros POR EMPRESA*, herramientas de SOLO
LECTURA que el agente consulta para responder con datos reales del negocio, con
diez condiciones duras (a..j) verificadas una por una en
[plan.md](plan.md#constitution-check). Motivación escrita: pedido explícito del
dueño (21-sep-2026) — el cliente Altos de Calamuchita ya opera un PMS con MCP
propio, y sin consultarlo el agente no puede responder disponibilidad, precios
ni enlaces, que es exactamente "atender y convertir conversaciones"
(Principio VIII).

**Alternativas descartadas**:
- *Extender la categoría 3 (integraciones por empresa vía OAuth)*: el MCP **no
  es OAuth** —es una credencial estática que entrega el proveedor— y lo habilita
  el **super admin empresa por empresa**, no el operador por entorno. Estirar la
  categoría 3 para que entre borraría justo las dos garantías que la hacen
  segura. Es categoría nueva, y el Sync Impact Report lo deja anotado.
- *Tratarlo como "el proveedor LLM" (categoría 2)*: no es un LLM ni pasa por el
  adaptador OpenRouter-compatible; el `chatJson` del repo no sabría qué hacer
  con un `tools/call`.
- *No hacer la feature y cargar precios a mano en el conocimiento del agente*:
  es lo que pasa hoy y es la causa del problema — precios congelados que el
  agente afirma como verdad. Empeora con cada temporada.

Tres correcciones a la propia enmienda, todas encontradas en revisión: la letra
(d) tal como estaba **prohibía el self-test** que exige el Principio IX (el
mcp-mock vive en `http://localhost`), y se cerró admitiendo loopback bajo el
gate de mocks; la letra (b) había perdido el **consentimiento y la desconexión
por la empresa** que la categoría 3 sí garantiza, y se le agregó; el Sync Impact
Report **reemplaza** la línea de encabezado en vez de insertarse antes (si no,
quedaban dos líneas consecutivas sobre 1.5→1.6) y agrega un sub-bloque
`Plantillas dependientes (1.7.0):` propio en vez de sobrescribir el de
1.1.0→1.2.0, que es registro histórico.

## D2 — La habilitación es la fila, y la escribe el super admin

**Decisión**: el conector no tiene "flag de feature". La **existencia de la fila
`mcp_integration`** es la habilitación: hace aparecer la tarjeta en
`/integrations`, y sin fila la ruta hace `notFound()` y cada endpoint devuelve
`404 not_enabled`. La crea, reconfigura y borra el super admin
(`withSuperAdmin`), que además es el **único** que escribe la `endpointUrl`. El
`status` separa `enabled` (habilitada, sin credencial) de `connected`,
`reconnect_required` y `disabled`.

**Alternativas descartadas**:
- *Columna en `organization`*: esa tabla es del plugin organization de Better
  Auth y hoy está intacta; meterle columnas de producto la acopla a cada
  actualización del plugin.
- *Tabla genérica `org_feature` de flags*: duplica el estado (flag + fila de
  configuración, que pueden contradecirse) y pierde el tipado estricto. La fila
  de configuración **es** el flag.
- *Variable de entorno por instancia*: no es por empresa, que es justo el
  requisito (FR-001).

Ocultar el ítem del índice es cosmética; la defensa real son las **tres capas
server-side** (índice, `notFound()` de la página, `404 not_enabled` de cada
endpoint con `withAuth` + `scoped()`), como ya hacen Administración y
Ajustes → Datos.

## D3 — La credencial: estática, cifrada, en una sola columna `jsonb`

**Decisión**: `credential jsonb {cipher, iv, tag}` cifrada con `encryptSecret`
(AES-256-GCM, `src/lib/crypto`), más `credential_last4` como único fragmento
visible. Precedente vigente: `push_vapid_key.privateKey`. Solo el `owner` de la
empresa la carga, rota y borra. Cambiar la `endpointUrl` la borra (FR-005) —
un super admin comprometido que reapunte el endpoint **no** cosecha el bearer
en la llamada siguiente, y hace falta una acción humana visible para volver a
cargarla.

**Alternativas descartadas**:
- *La terna de columnas `cipher/iv/tag` de `calendar_integration`*: acá el
  secreto es **nullable en bloque** (la fila existe habilitada y sin
  credencial), y tres columnas nullable sincronizadas a mano son el patrón
  frágil que ya tiene `calendar_integration.accessToken*`. Una sola columna hace
  imposible el estado medio. *Es la única decisión de estilo que queda abierta:
  si el dueño prefiere uniformidad, la terna funciona igual.*
- *OAuth contra el MCP*: el servidor no lo ofrece; la credencial la entrega el
  proveedor a mano.
- *`authScheme: 'meta'`* (credencial dentro del cuerpo JSON-RPC, en
  `_meta.api_key`): **eliminado de v1**. La mitigación posible era de orden
  ("inyectar `_meta` después de serializar lo que se audita") y protegía
  `mcp_tool_call.args` y nada más: no cubre los objetos de error de Node, ni el
  `console.error` genérico de `src/lib/api.ts`, ni un reintento que re-serialice
  el cuerpo. Queda `bearer` (que es lo que el servidor real acepta) y, si algún
  día vuelve otro esquema, **cambiar `authScheme` también borra la credencial**.

## D4 — Un servidor MCP por empresa

**Decisión**: `uniqueIndex(organization_id)`, como `ai_credentials_org_uq` y
`calendar_integration_org_uq`.

**Alternativa descartada**: soportar N servidores desde el día 1 — agrega un
discriminante (`slug`) a cada query sin un solo usuario que lo justifique.
Migrar a N después es aditivo (`+ slug` y unique compuesto); al revés no.

## D5 — Protocolo: un POST por llamada, sin sesión y sin SDK

**Decisión**: cliente propio de ~5 archivos. El servidor real es **sin estado
para nuestro uso** (verificado): `initialize` devuelve un header
`mcp-session-id`, pero `tools/list` y `tools/call` responden 200 **sin**
reenviarlo y **sin** haber mandado `notifications/initialized`. Entonces: un
POST por llamada, sin handshake previo, sin reconexión. Igual se guarda
`session_mode` en la fila (`stateless` | `initialize`) porque la spec de
Streamable HTTP permite las dos cosas y otro servidor puede exigir la sesión: lo
decide el handshake, no una suposición cableada. `protocolVersion` declarado:
`2025-06-18`.

**Alternativas descartadas**:
- *`@modelcontextprotocol/sdk`*: dependencia nueva de runtime, contra el
  Principio II, para ~150 líneas de JSON-RPC sobre HTTP. Además el SDK no
  resuelve nada de lo que sí necesitamos (tope de bytes, hook de `lookup`,
  aserción de sandbox) y nos ataría a su política de transporte.
- *SSE bidireccional persistente*: el servidor responde `application/json` puro
  aunque se mande `Accept: application/json, text/event-stream`. El cliente
  igual **tolera** framing SSE por si cambia —parsear frames `data:` son ~15
  líneas sin dependencias— y corta con `req.destroy()` en cuanto llega el primer
  objeto JSON-RPC cuyo `id` coincide con el de la request, para no retener el
  socket hasta el timeout si el servidor deja el stream abierto.
- *Subscripciones / resources / prompts del protocolo*: fuera de alcance; no
  aportan nada al caso de uso.

## D6 — El doble sobre: nunca alcanza con mirar el status HTTP

**Decisión**: `unwrapToolResult()` es una función propia y testeada. El servidor
devuelve los errores de aplicación con **HTTP 200 + `result.isError:true`**, y
el detalle vive en un **JSON anidado dentro de `result.content[0].text`**
(`{"success":false,"error":{"code","message",…}}`). Hay que parsear ese string;
si no parsea → `bad_payload`.

Y los errores traen campos que permiten al modelo autocorregirse en la vuelta
siguiente, así que el `toolText` los reinyecta en vez de tragárselos:
`date_out_of_window` → `window{from,to}`; `unknown_city` → `accepted[]`;
`invalid_guests` → `max`; `unknown_property_type` → `accepted[]`.

**Alternativa descartada**: tratar `isError` como fallo de transporte y degradar
a "no disponible". Convierte un rechazo educable ("esa localidad no existe, las
disponibles son…") en un handoff, que es exactamente perder el lead.

Este es **el punto de valor del mcp-mock**: si el mock no replica el doble sobre
literalmente, el parser nunca se ejercita y el E2E pasa en verde sobre código
que en producción no funciona.

## D7 — Perfil por proveedor, y la allowlist no sale de `tools/list`

**Decisión**: un `McpProfile` por proveedor con `allowedTools`, `requiredTools`,
`catalogTool`, `linkHosts`, `agentActions` y seis funciones **puras**
(`parseCatalog`, `renderSection`, `validate`, `render`, `sandbox`). Las únicas
herramientas invocables son las de `allowedTools`; lo que el servidor declare en
`tools/list` es **dato**, no permiso. Como refuerzo, el servidor real anota las
tres con `{readOnlyHint:true, idempotentHint:true, openWorldHint:false}` y el
handshake exige esa anotación: una herramienta sin ella no entra al prompt ni se
puede ejecutar.

**Alternativas descartadas**:
- *Conector genérico que le pase al modelo el `inputSchema` de cada herramienta
  y lo deje elegir*: exigiría validar un JSON Schema arbitrario en runtime
  (los opcionales del servidor real usan tipos unión con `null`:
  `{"type":["string","null"]}`), renderizar una salida sin contrato —**ninguna
  herramienta publica `outputSchema`**— y confiar en que es de solo lectura,
  cosa que solo afirma la descripción que escribe el propio servidor. Ninguna de
  las tres es trabajo de v1.
- *Derivar la allowlist de `readOnlyHint`*: el hint es útil como condición
  adicional, pero si fuera la única barrera, un servidor comprometido se
  autoriza a sí mismo escribiendo `true`.

El perfil `generic` es la degradación honesta: conecta, hace el handshake y
muestra `serverInfo`, `instructions` y la lista de herramientas — y el agente no
ve nada (`agentActions: []`). Sirve para diagnosticar antes de que exista un
perfil, sin abrir superficie.

## D8 — Condensar no es opcional: 19 KB → 1,45 KB

**Decisión**: el perfil **re-renderiza** la respuesta desde los campos
estructurados; nunca se inyecta el JSON crudo al contexto del agente. Medido
contra el servidor real: `list-search-options` devuelve **16 KB** (82
características, 5 tipos, 2 localidades) y `check-availability` con 5 resultados
devuelve **19 KB** (cada propiedad con 1.300–2.500 B de copy de marketing). El
render condensado medido baja a **1.450 B (−90,6 %)**: una línea por propiedad
con nombre corto, código, capacidad, dormitorios, baños, localidad, total,
precio por noche, depósito y enlace.

Del catálogo van al prompt solo tipos + localidades + ventana de fechas +
moneda; las 82 características no van completas. Y `MAX_PROPERTIES_FOR_MODEL`
baja de 3 a **2, con un solo enlace por mensaje** (el de la búsqueda): WhatsApp
previsualiza únicamente el primero y tres enlaces quedan como un muro. El enlace
de una propiedad puntual se pasa solo cuando el cliente la pide.

`pricing` = `{currency, nights, price_per_night, accommodation, services, total,
deposit}`. El `deposit` **no es un porcentaje fijo** (varía por propiedad): se
muestra tal cual y **jamás se calcula**. Si `currency !== "ARS"` se imprime el
código y no se convierte.

**Alternativas descartadas**:
- *Pasar el JSON recortado al modelo*: cada vuelta reenvía el system prompt
  completo (con todo el conocimiento del negocio) más el historial; 19 KB por
  llamada de herramienta multiplican el costo y empujan al truncado.
- *Armar los enlaces a mano desde el catálogo*: el propio servidor avisa en
  `search_link.notes` que el buscador del sitio **filtra distinto** que el MCP
  (habitaciones exacto en vez de mínimo, sin filtro de baños, características en
  AND). Se usa siempre el `search_url` que devuelve `check-availability`. El
  `conversation_id` viaja como `cid=` en ese enlace y en el de cada propiedad:
  le da al cliente la atribución del lead, que es un beneficio real.

## D9 — Anti-SSRF: lo que falla en las implementaciones caseras

**Decisión**: tres controles encadenados, cada uno cerrando un agujero
concreto y verificado empíricamente.

1. **IP literales rechazadas en `checkEndpointSyntax`.** Node **no invoca el
   `lookup`** cuando el host ya es una IP, y el parser WHATWG normaliza las
   formas raras a IPv4 punteado: `https://2130706433/`, `https://0x7f.1/` y
   `https://0/` llegan como `127.0.0.1` / `0.0.0.0` con punto incluido, así que
   pasarían cualquier chequeo de "tiene al menos un punto". Un PMS público tiene
   dominio y certificado: la IP literal no es un caso de uso y se rechaza.
2. **`guardedLookup` que maneja `all: true`.** `autoSelectFamily` es `true` por
   defecto desde Node 20 y acá corre Node 22: Node llama al lookup con
   `{hints:1024, all:true}`, y con `all` el callback recibe un **array** de
   `{address, family}`. Una implementación escrita contra la firma
   `(address, family)` recibiría el array, `net.isIP(array)` daría `0` y la
   función devolvería "no bloqueado": un **fail-open silencioso**. Se validan
   **todas** las direcciones resueltas (Happy Eyeballs puede elegir cualquiera)
   y se pasa `autoSelectFamily: false` para reducir la superficie a una
   conexión.
3. **Lista de rangos completa**, sobre la IP resuelta. IPv4: `0/8`, `10/8`,
   `100.64/10`, `127/8`, `169.254/16` (incluye toda la metadata de nube),
   `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.88.99/24`, `192.168/16`,
   `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`,
   `255.255.255.255` y `100.100.100.200`. IPv6: `::`, `::1`, `fc00::/7`,
   `fe80::/10`, `fec0::/10`, `ff00::/8`, `64:ff9b::/96`, `2002::/16` (6to4),
   `::/96` —**IPv4-compatible: `[::a9fe:a9fe]` *es* `169.254.169.254`**— y
   desmapeo de `::ffff:0:0/96` para aplicarle las reglas v4.

Más: `checkEndpointSyntax` corre **también dentro de `postJsonRpc`** (la fila
puede cambiar entre validación y uso); todo 3xx → `unexpected_redirect` sin
seguirlo (seguirlo arrastraría el bearer); `Accept-Encoding: identity` explícito
y rechazo de cualquier `content-encoding` distinto, para que el tope de bytes no
se vuelva decorativo el día que alguien agregue `zlib`; y ni el cuerpo ni el
mensaje del remoto se persisten, para no convertir la pantalla del super admin
en un oráculo de escaneo interno.

**Alternativas descartadas**:
- *Validar la URL una vez al guardarla y confiar después*: es el TOCTOU de DNS
  rebinding — un registro con TTL 0 resuelve a `1.2.3.4` en la validación y a
  `10.0.0.5` cinco milisegundos después.
- *Resolver primero y conectar a la IP forzando el `Host`*: rompe TLS/SNI. Con
  `lookup` + `servername` el certificado se valida contra el hostname real.
- *Una librería de SSRF*: dependencia nueva para lo que son 60 líneas de
  aritmética sobre `net.isIP`.

Superficie real: solo el super admin escribe la URL, así que el atacante
realista ya comprometió la cuenta de plataforma. Todo esto es defensa en
profundidad, y hace falta igual: la app corre en Railway/Coolify, con salida a
Internet y una vecindad de red que no controlamos.

## D10 — El mcp-mock: fidelidad literal y log de llamadas

**Decisión**: `src/server/dev/mcp-mock-state.ts` + `POST
/api/dev/mcp-mock/assistant` + `GET|POST|DELETE /api/dev/mcp-mock/state`, tras
el `mockGuard()` único (404 incondicional en producción). La ruta `assistant/`
hace que la URL del mock sea análoga a la real y solo cambie el host.

Tres exigencias de fidelidad, porque un mock indulgente es peor que no tener
mock: (1) el **doble sobre es literal** (string con JSON adentro; error =
`isError:true` + `{success:false,error:{code,message}}` dentro de ese texto);
(2) `initialize` y `tools/list` responden **sin** credencial y `tools/call` la
exige; (3) **los filtros filtran de verdad** (`property_type`, `city`,
`bedrooms`, `facilities` en AND vs `facilities_any` en OR) — si no, el E2E no
distingue "el agente pasó los filtros" de "el agente no los pasó". Los datos son
deterministas y la ventana de fechas es **relativa a `now`**, para que el guion
no caduque.

Knobs: `nextUnauthorized`, `forceError:"<code>"`, `failNextCall` (HTTP 500, que
es caída de transporte y no `isError` de aplicación), `delayMs`,
`malformedNext`, `emptyResults`, `hugeResponse`, `evilText` y `redirectNext`.
El `GET` devuelve `{knobs, calls:[{at,tool,arguments,auth,conversationId}]}`:
**ese log es lo que hace verificable el sandbox** — sin él, "el agente no tocó
el MCP en el Laboratorio" no se puede afirmar.

**Alternativa descartada**: apuntar el E2E al servidor real con la credencial
del cliente. Tráfico productivo desde una corrida de prueba, resultados no
deterministas (la disponibilidad cambia sola) y una credencial de producción en
cada máquina de desarrollo.

## D11 — `node:https`: el primer cliente HTTP crudo del repo

**Decisión**: `src/lib/mcp/transport.ts` usa `node:https` directo.

**Lo verifiqué yo mismo antes de escribir esto**:
`src/lib/google/calendar-client.ts:25-70` usa **`fetch` + `AbortController`**
(`const controller = new AbortController()`, `signal: controller.signal`,
`clearTimeout(timer)` en el `finally`), y un `grep` de `node:https` sobre `src/`
no devuelve nada. Así que **no hay precedente**: es código nuevo de 016 y se
declara como tal, no se disfraza de patrón existente. Lo único que sí se reusa
de `calendar-client.ts` es la *forma* del timeout (timer propio + limpieza en
`finally`), no su mecánica.

**Por qué igual es la decisión correcta** — `fetch` no puede hacer dos cosas que
acá no son negociables:
1. **Limitar el tamaño de la respuesta sin bufferearla entera.** Con `node:https`
   se acumulan chunks contando bytes y al pasar `maxResponseBytes` se llama a
   `req.destroy()`. El `content-length` se usa como atajo, nunca como garantía.
2. **Interponerse en la resolución DNS que consume el socket.**
   `request({ lookup: guardedLookup, servername: url.hostname })` hace que el
   chequeo de IP ocurra *dentro* de la resolución real (D9), con TLS y SNI
   intactos. Con `fetch` esa ventana queda abierta.

Además permite la **aserción dura de sandbox** antes de cualquier I/O y hace el
transporte testeable inyectando `request` (patrón `sendPush(…, {transport})`).

**Alternativas descartadas**: `fetch` (no cumple 1 ni 2); `undici` con un
`Agent` y `connect.lookup` (dependencia nueva de runtime, contra el Principio
II, para lo mismo que `node:https` ya hace); un proxy de salida (infraestructura
nueva que el instalador tendría que desplegar, contra la letra (g)).

**Consecuencia asumida**: `tests/unit/mcp-transport.test.ts` deja de ser
opcional — tope de bytes con `destroy`, 3xx rechazado, timeout, `content-type`,
frame SSE cortado al primer objeto y `sandbox:true` lanzando
`sandbox_violation`, todo con `request` inyectado.

## D12 — Sandbox del Laboratorio: el corte va dentro de `callGuarded`

**Decisión**: `if (input.sandbox)` vive **dentro de `callGuarded`**, después del
chequeo de allowlist y **antes** de resolver la credencial: devuelve
`profile.sandbox(action)` y **escribe la fila `mcp_tool_call` con
`is_test=true`**. El booleano viaja explícito por parámetro en toda la cadena
(`pipeline` → `executeStaySearch(…, sandbox)` → `callGuarded({sandbox})` →
`postJsonRpc({sandbox})`), nunca desde un global, con origen en
`conversation.isTest`. Segundo cinturón: `postJsonRpc` lanza
`McpError("sandbox_violation")` antes de cualquier I/O si el booleano llega en
`true`.

**Alternativa descartada**: cortar antes, en `agent-tools.ts`. Era la versión
inicial y tenía dos defectos que se descubrieron leyendo el propio E2E: (1) la
fila `is_test` **no se escribía nunca**, así que el paso del guion que la
consulta era imposible de pasar y el comentario del DDL describía una fila que
nadie escribe; (2) es exactamente el patrón que la arquitectura rechaza —«los
guardrails no pueden depender de que cada caller los recuerde». Con el corte
adentro, el sandbox además ejercita la allowlist y la bitácora, que de otro modo
el Laboratorio no tocaría jamás.

Corolario de la misma revisión: `loadMcpContext` cambia de firma a
`loadMcpContext(organizationId, conversationId, { sandbox })` y **no refresca el
catálogo en sandbox**. El diseño se contradecía —una parte decía "no toca la
red", otra disparaba un `tools/call` de refresco— y el Laboratorio corre
`runAgentTurn`: una corrida con catálogo vencido habría generado tráfico real al
PMS del cliente, registrado con `is_test=false`, invisible para la evidencia.
Y ese `void refreshCatalog(...)` lleva `.catch(() => undefined)`: **una promesa
rechazada sin manejar es fatal en Node**, y un 500 del PMS habría reiniciado el
proceso de Next.js, tumbando los turnos en vuelo, el mapa de coalesce, el lock
del entrenador y los buckets de rate limit — justo lo que la letra (j) prohíbe.
El patrón ya está en `src/lib/api.ts:141` y en `src/server/lab/runner.ts:52`.

## D13 — Por qué NO se rechaza server-side un `kb_add` con monto

**Decisión**: cuando el conector está conectado con perfil de alojamientos, el
entrenador (015) **no** rechaza server-side una entrada de conocimiento que
contenga un monto. La defensa es de tres piezas, ninguna destructiva:
1. `buildTrainerSystemPrompt` recibe `mcpLiveDataNotice` y le explica al agente
   que precios, disponibilidad y características se consultan en vivo, que no
   los guarde, y que si el dueño se los dicta responda con `reply` sin aplicar
   el cambio. Políticas (check-in, mascotas, formas de pago, cancelación) sí se
   guardan.
2. Rama del ai-mock que reproduce ese comportamiento, y un **paso propio del
   E2E** que dicta un precio al entrenador y verifica que no se escribe al
   conocimiento. Un unit test del prompt solo verifica que la frase esté; no
   verifica el comportamiento.
3. `KbConflictCard` en la pantalla del conector: lista las entradas existentes
   que matchean un patrón de moneda para que el dueño las borre **de a una**.

**Alternativa evaluada y rechazada**: un heurístico server-side que rechace
`kb_add`/`kb_update` cuando el texto contiene un monto. Tres motivos:
- **Falsos positivos caros sobre español libre.** «Cobramos por adelantado el
  30 %», «la seña es del 50 % y no se devuelve», «hasta $20.000 de daños los
  cubre el seguro» son políticas legítimas que el negocio necesita en el
  conocimiento. Un heurístico las bloquea y el dueño no entiende por qué su
  herramienta dejó de funcionar.
- **El entrenador es una herramienta del dueño, no una superficie hostil.** El
  modelo de amenaza de esta feature es el texto del *tercero*; acá el autor es
  el propietario de la empresa, autenticado, editando su propio conocimiento,
  con historial y «Deshacer» ya construidos en 015.
- **Es una prohibición sin escape.** Si el dueño *quiere* cargar un precio de
  temporada que el PMS no publica, un rechazo duro no le deja alternativa.

Riesgo residual asumido: un precio dictado igual puede terminar en el
conocimiento si el modelo desobedece el prompt. Lo hace visible el historial de
cambios del entrenador y lo corrige `KbConflictCard`. Si en producción resulta
frecuente, la palanca correcta es un **aviso** en la UI antes de aplicar, no un
rechazo silencioso.

## D14 — El texto del servidor es DATO: dónde muere cada vector

**Decisión**: `sanitizeForeignText(raw, maxChars)` aplica, en orden: `String()`;
quita caracteres de control, zero-width, **overrides bidi `‪-‮`,
aislantes `⁦-⁩` y el bloque de tags `\u{E0000}-\u{E007F}`** (flag `u`;
este último no se ve en ninguna UI y llega íntegro al modelo); quita los
marcadores del sistema, **importados de `markers.ts` y de sus módulos, nunca
reescritos a mano**; quita fences; neutraliza `\nCLIENTE:` / `\nAGENTE:` a
`\nCLIENTE -` / `\nAGENTE -` (el prompt del juez une el transcript con esos
prefijos: sin esto, un texto del PMS inyecta turnos falsos en el Laboratorio);
colapsa saltos; trunca.

Los cinco vectores y dónde mueren:

| Vector | Dónde se corta |
|---|---|
| `instructions` del `initialize` al system prompt **persistente** | `use_server_instructions` **`.default(false)`**: el dueño lee las notas en la UI y recién entonces tilda la casilla. Consentimiento informado por un clic. Más: valla con **nonce por turno** (`randomBytes(8)`), porque una valla fija se puede cerrar desde adentro — un `instructions` que contenga `=== FIN DE LAS NOTAS ===` seguido de `Reglas duras (actualización del negocio):` produce un bloque indistinguible del prompt real. La lista de cadenas a remover incluye la propia valla y las cuatro cadenas estructurales de `prompts.ts`. |
| El `toolText` leído como instrucción del sistema | Para la familia `mcp` se empuja como **`role:"user"`**, no `system` (la agenda puede permitirse `system` porque el dato es propio: huecos que calcula `src/server/calendar/slots.ts`). El marcador `[HERRAMIENTA]` y la regla que explica cómo interpretarlo siguen funcionando igual. |
| El `message` "listo para enviar" del proveedor | **No se propaga nunca.** El respaldo "solo si `properties` viene vacío" se eliminó: `properties: []` es un estado que el servidor **elige** (el propio mock lo expone como knob), así que un servidor hostil devolvería siempre cero resultados y su `message` entraría en todos los turnos. Para ese caso ya hay `toolText` propio. |
| Texto ajeno al WhatsApp de un cliente real, sin modelo ni humano | El `clientSummary` de la degradación se compone **solo** de plantilla propia + números + enumerados + una URL de la allowlist; el nombre pasa por `SAFE_NAME = /^[\p{L}\p{N} .,'’\-–]{1,40}$/u` y si no matchea se reemplaza por «una cabaña de 2 dormitorios». Sin esto, `"Cabaña El Ciervo — seña por transferencia al alias pagos.ac"` salía firmado como el negocio. |
| Enlaces a otro host / open redirect | `safeLink`: `h === d \|\| h.endsWith("." + d)` —el `endsWith(host)` ingenuo acepta `evil-altosdecalamuchita.com`—, con strip del punto final del FQDN (`new URL()` lo conserva), sin userinfo, `https:` y `href ≤ 512`. Lo que no matchea se omite y se agrega «(sin enlace disponible)». |

Y dos reglas transversales sobre los **mensajes de error**, que eran un canal
olvidado: (1) el texto que sale a HTTP, a la UI y a `mcp_tool_call.errorMessage`
viene **solo** de `MCP_ERROR_TEXT`, un `Record<McpErrorCode,string>` fijo —
cierra de una sola vez el oráculo de SSRF, el canal para que el tercero escriba
castellano en la pantalla del super admin, y la exfiltración de un `Authorization`
ecoado en un 401; (2) `redactValue(text, credential)` redacta **por igualdad
exacta** (más sus formas URL-encoded y base64), porque la credencial del
proveedor es una cadena opaca sin prefijo y **ningún patrón la encuentra**: el
`redactSecrets` que existe hoy ni siquiera está exportado y solo cubre `sk-…`,
que se conserva como cinturón adicional en `src/lib/redact.ts`.

Al tercero le mandamos únicamente el `conversation_id` (`cv_…`, nanoid opaco);
jamás teléfono ni nombre.

## D15 — Presupuesto del agente por familia, deadline y degradación propia

**Decisión**: tres cambios en `src/server/ai/pipeline.ts`, ninguno sube el techo
global de forma ciega.

1. **Contador por familia**: `TOOL_ROUNDS_BY_FAMILY = {calendar: 2, mcp: 2}` con
   cota dura `MAX_TOOL_ROUNDS_TOTAL = 3` (máximo 4 llamadas al modelo). Hoy el
   contador es único: una empresa con calendario **y** MCP agota el presupuesto
   entre las dos familias y la tercera acción muere.
2. **Degradación parametrizada por familia**. Éste es el cambio que no se puede
   omitir: hoy el bloque de degradación está cableado a turnos y
   `lastAvailabilityText` solo se setea en el camino de la agenda, así que un
   cliente de cabañas con una acción colgada recibe literalmente *«Te confirmo
   el turno con el equipo en un momento.»* Bug de producto garantizado.
3. **Deadline de turno** (`TURN_DEADLINE_MS = 45_000`) que acota **tanto**
   `chatJson` **como** `callGuarded`:
   `timeoutMs: Math.min(integration.timeoutMs, deadline - Date.now())`. Sin la
   segunda mitad, con `timeoutMs` de hasta 30 s por empresa y tres vueltas, un
   turno podía retener ~90 s de sockets y la afirmación "acotado a 45 s de
   reloj" era falsa — y el Laboratorio, con `RUN_TIMEOUT_MS` de 10 minutos y 6
   personas **secuenciales**, se convertía en un timeout garantizado.

Más: `seenArgs` **implementado como `Map`** (no solo declarado) que reusa el
`toolText` cacheado con el prefijo «Ya consultaste exactamente esto»; y la
degradación de la familia `mcp` usa **`deliverConversationalReply`**, no
`deliverReply`.

**Alternativa descartada** para ese último punto: el paralelo con
`lastAvailabilityText`, que sí usa la vía directa. No se sostiene: los otros
casos de vía directa **confirman una acción ya ejecutada** (una reserva que
ocurrió) y esa es la excepción que el propio código documenta; un resumen de
búsqueda no ejecutó nada, es una respuesta conversacional. Con la vía directa,
un cliente que corrige «uy no, somos 6» mientras el turno corre recibe el
resumen con precios para 4 y, 20 segundos después, el de 6: dos precios
distintos seguidos, que es exactamente lo que las guardas de 011 existen para
impedir.

Peor caso acotado y verificado: 4 `chatJson` × 3 intentos internos = 12 POST al
proveedor (hoy son 9) y 2 llamadas al MCP, con el `for` acotado garantizando que
ninguna rama queda sin `return`/`break`.

## D16 — Dos acciones con vocabulario disjunto, normalizador y campos opcionales

**Decisión**: `search_stays` y `show_stay`.

- **Nombres disjuntos a propósito**: `check_availability` ya existe para la
  agenda. Dos acciones con nombre casi igual y semántica distinta son una
  invitación a que el modelo confunda "turno de 30 minutos" con "estadía de dos
  noches". El mismo riesgo existe en el ai-mock, cuyo regex de calendario
  incluye `disponibilidad`: por eso `dispatchStays` va **antes** de
  `dispatchCalendar` (y después de la rama de "pide un humano", que corta mucho
  antes), y el prompt lleva una línea de desambiguación: *la AGENDA es para
  visitas o reuniones en el negocio; ALOJAMIENTOS es para estadías con fecha de
  entrada y salida*.
- **`check_out` y `guests` opcionales en Zod**, con rechazo **semántico** en
  `validate()` («FALTA LA SALIDA: preguntale al cliente cuántas noches se
  queda»). Con los tres obligatorios, que el modelo omita uno —frecuentísimo
  cuando el cliente dijo solo «para el 25»— cuesta 3 POST completos con
  reintento STRICT y termina en `handoff("error")`: el cliente no recibe nada y
  la conversación queda marcada para un humano **por un campo**. El reparto
  correcto ya existe en el repo: `check_availability.date` es opcional
  justamente para que el modelo no pueda fallar, y la semántica se enseña con
  texto.
- **`normalizeAgentOutput` + `z.preprocess`**, replicando el fix `8d11b7d` del
  entrenador (el modelo devolvía la forma casi-correcta tres veces seguidas y el
  turno degradaba a "el proveedor no respondió"). Cubre seis casos y ni uno
  más: `{action, args:{…}}` aplanado; `{tool|name:"check-availability",
  arguments:{…}}`; fechas ISO completas → `YYYY-MM-DD`; `facilities` como string
  separado por comas; **`dd/mm/yyyy` → ISO**; **`guests:"4 personas"` → 4**.
  `AgentActionType` se exporta desde el union *strict*, no desde el preprocess,
  para no tocar `degradeAction` ni el pipeline.
- **Validación semántica contra el catálogo antes de gastar una llamada**:
  formato y realidad de las fechas, salida posterior a la entrada, dentro de la
  ventana publicada, `guests` contra el máximo, `city` y `property_type`
  normalizados contra el catálogo (minúsculas + sin acentos), y las
  características desconocidas **se descartan con aviso** en vez de abortar la
  búsqueda («Ignoré estas características que no existen en el catálogo:
  helipuerto»). Sin catálogo se saltean los chequeos y el MCP responde su propio
  `unknown_city`, que se traduce con el mismo tono: degradación, no bloqueo.
- **Dos reglas de dominio que el prompt tiene que decir explícitamente**, porque
  vivían solo en comentarios del código que el modelo no lee: `facilities` =
  TODAS obligatorias (AND) vs `facilities_any` = alcanza con una (OR), *ante la
  duda usá `facilities`* (si no, «queremos pileta y parrilla» devuelve cabañas
  sin pileta); y **los menores cuentan como huéspedes** («somos 4 y dos chicos»
  son 6 en el Río de la Plata), con la obligación de repetir fechas, noches y
  personas en toda respuesta con precios.

**Alternativas descartadas**: *tool-calling nativo* (no todos los modelos de
OpenRouter lo soportan igual; el contrato JSON-acción del repo ya tolera formato
inesperado con extracción robusta + reintentos); *una sola acción con un campo
`mode`* (el discriminated union de Zod deja de discriminar y el modelo pierde la
señal del nombre).

Sobre claves inventadas: Zod v3 hace *strip*, no *strict* — `"helipuerto": true`
se descarta en silencio y nunca llega al MCP. Los **valores** inventados dentro
de un campo declarado los ataja la validación semántica, sin gastar una llamada.

## D17 — El conocimiento deja de ser "la única fuente de verdad" (condicionalmente), y el juez del Laboratorio

**Decisión**: `buildAgentSystemPrompt` **enmienda condicionalmente** dos líneas
del prompt cuando hay conector con herramientas, en vez de agregar una sección
que las contradiga:
- *«CONOCIMIENTO DEL NEGOCIO (tu única fuente de verdad…)»* → *«…tu fuente de
  verdad **para todo salvo precios, disponibilidad y características de las
  propiedades, que consultás EN VIVO**»*.
- *«Si la pregunta NO está cubierta por el conocimiento → NO inventes: responde
  que lo confirmarás o escala»* → se le agrega *«Las preguntas sobre
  propiedades, precios y disponibilidad SÍ están cubiertas: se responden
  consultando el sistema, **no escalando**.»*

**Por qué no alcanzaba con agregar la sección**: quedaban dos absolutos
contradictorios en el mismo system prompt, con dos disparadores muy probables.
(1) El dueño cargó a mano «¿Cuánto sale la cabaña? Desde $80.000 la noche» antes
de conectar: ante «cuánto sale?» el modelo tiene respuesta en el conocimiento
**más** la regla de que el conocimiento es la única verdad, y contesta $80.000
sin llamar a la herramienta. Ninguno de los cinturones lo ataja: todos son sobre
*reservas*, no sobre *precios viejos*. (2) «¿Aceptan mascotas?»: el catálogo
tiene la característica, o sea la respuesta correcta es buscar; el conocimiento
no dice nada, así que la regla manda **escalar** — handoff en la primera
pregunta de la feature.

**Y el juez del Laboratorio necesita `liveDataSection`.** El juez **nunca ve el
`toolText`**: el transcript se arma leyendo la tabla de mensajes, y el prompt
del juez recibe solo persona, comportamiento, conocimiento y transcript.
Entonces ve «el agente dijo $248.000 por la Cabaña El Ciervo» contra un
conocimiento que no menciona cabañas, y su propia instrucción lo obliga a
marcar `alucinacion`: **toda empresa que conecte el conector vería su score
desplomarse sin defecto real**. `buildJudgePrompt` recibe los fixtures usados en
la corrida y la regla explícita de que esos datos no son alucinación (sí lo es
cualquier precio o propiedad que no esté en esa lista), más una persona de
alojamientos en el Laboratorio.

**Alternativa descartada**: barrer automáticamente del conocimiento las entradas
con montos al conectar. Destructivo e irreversible sobre trabajo del dueño; lo
que entra es `KbConflictCard`, que las lista para que las borre de a una (D13).

## D18 — La zona horaria: «hoy» sale de la ventana del catálogo

**Decisión**: el «hoy» que va al prompt se toma del **inicio de la ventana
publicada** por `list-search-options` —la autoridad del proveedor, cero
configuración nueva— y, como respaldo, una columna `timezone` en la fila con
default `America/Argentina/Cordoba`.

**Por qué**: hoy `buildAgentSystemPrompt` no inyecta ninguna fecha por su
cuenta; la única que llega viene de la agenda, que sí tiene zona. En Railway el
proceso corre en UTC: a las 21:10 de Córdoba el servidor ya está en el día
siguiente, así que «mañana» se resuelve con un día de más y se cotiza una noche
que no es. Para cabañas, el prime time de WhatsApp es justamente la noche.

**Alternativa descartada**: una variable de entorno de zona horaria de
instancia — rompe la superficie de env cero (D21) y sería errónea el día que dos
empresas de la misma instancia estén en husos distintos.

## D19 — Memoria conversacional: los argumentos de la última búsqueda

**Decisión**: `loadMcpContext` lee los `args` de la última llamada OK de **esa
conversación** (índice `mcp_tool_call_org_conv_idx`) y los renderiza en la
sección: *«Última búsqueda de este cliente: 2026-10-10 → 2026-10-12, 4 personas,
filtros: pileta. Si pregunta una variante ("y con pileta", "y más barato"),
reusá estos datos sin volver a preguntar.»*

**Por qué**: el `toolText` vive solo en el array del turno; el turno siguiente
arma los mensajes desde la tabla, o sea solo lo que el agente **dijo**. Si su
respuesta fue la natural de WhatsApp («Tengo El Ciervo a $248.000 y Los Aromos a
$210.000, mirá acá 👉 link»), en el turno siguiente no hay fechas ni cantidad de
personas, y ante «¿y con pileta?» el modelo —cumpliendo la regla de preguntar lo
que falta— **vuelve a pedir las fechas que el cliente ya dio**, en el peor
momento posible: cuando estaba a un clic.

La tabla ya guardaba `args` + `conversation_id` para diagnóstico; esto es leerla.
**Alternativa descartada**: persistir el `toolText` como mensaje del hilo —
ensucia la bandeja con texto de sistema y lo expone al transcript del juez.

## D20 — «Me la reservás vos?»: la única defensa verificable

**Decisión**: una función **pura** en `src/server/mcp/promise-guard.ts` (molde
de `isPlainAcknowledgment` y `HANDOFF_BACKUP_REGEX`) que corre sobre el texto
saliente cuando el perfil es de alojamientos:
`/te (la |lo )?(reserv|guard|bloqu|apart)|queda (reservad|tomad|guardad|bloquead)|se[ñn][eé]|ya te (la |lo )?dej/i`.
Al matchear: se reemplaza el texto por la frase segura + el enlace, se registra
el incidente y se cuenta. Y el ai-mock gana un knob `forcePromise` que le hace
escribir la frase prohibida, para que el paso del E2E pueda **fallar**.

**Por qué**: los otros cuatro cinturones son texto del prompt o estructura. El
cuarto —«no existe acción de reserva en el union»— no impide el riesgo real: el
riesgo no es que el modelo llame a una herramienta que no existe, es que
**escriba** `{"action":"reply","text":"Dale, te la reservo y te confirmo"}`, y
Zod acepta cualquier string en `reply`. Y el paso del guion que decía verificarlo
por regex sobre el outbox era **tautológico**: la respuesta la produce
`dispatchStays`, que escribimos nosotros y que por construcción jamás dirá «te
la reservo». Un paso que no puede fallar no prueba nada.

**Alternativa descartada**: hacer `handoff` cada vez que el modelo se cuelga, en
vez del envío directo con plantilla propia. Pierde el lead en el momento de
mayor intención de compra; con `SAFE_NAME` + `safeLink` (D14) el resumen no
contiene un solo carácter elegido por el tercero fuera de un nombre de 40
caracteres de un charset conservador.

## D21 — Superficie de entorno exactamente cero (y la credencial que estaba en `.env`)

**Decisión**: 016 **no agrega ninguna variable de entorno**. Ni a
`src/lib/env.ts` ni a `.env.example`, que está trackeado y es la guía del
instalador. Se descarta también `MCP_DEFAULT_ENDPOINT_URL` (azúcar de UI para
prellenar el formulario del super admin): es lo único que faltaba para que la
superficie sea cero exacto, y cero exacto **es el mejor argumento constitucional
de la feature** frente a la letra (g). El permiso de `http://` para el mcp-mock
no es una variable nueva: se deriva de `isMockEnabled()`.

`ALTOS_MCP_URL` / `ALTOS_MCP_TOKEN` quedan en `.env` como **placeholders
`REEMPLAZA_...`** con guía inline, documentadas en el encabezado de
`scripts/mcp-smoke.mjs`, que lee la credencial de `argv`/stdin, no la persiste y
no imprime el cuerpo de la respuesta sin redactar.

**Y una acción operativa, no de código**: hoy hay una credencial **productiva
del PMS de un cliente en texto plano** en `.env` — en la máquina de cada
desarrollador, en el historial de shell de quien haga `source .env` y en
cualquier CI que copie el archivo — para una feature cuyo argumento central es
que las credenciales viven cifradas en la base. Se **rota con el proveedor**
después del smoke, como tarea propia del plan.

**Alternativa descartada**: meter el nombre de variable de un cliente con nombre
y apellido en el `.env.example` público de un repo MIT. Contradice en el mismo
commit la letra (g) que se está escribiendo.

## D22 — Riesgos residuales: aceptados, acotados y escritos

Ninguno de estos se resuelve en v1. Se documentan acá porque el Principio VII
pide trazabilidad y porque un riesgo escrito es un riesgo que alguien puede
revisar; silenciarlo es lo que lo vuelve peligroso.

**R-1 · El texto del PMS puede llegar al conocimiento por la ruta larga.** Era
falso afirmar que «el texto del MCP nunca se escribe en `kb_entry` ni en
`appendLeadNote`; el diseño no tiene esa ruta». **La ruta existe y es el
modelo**: `update_lead` copia a `appendLeadNote` el `note` que escribe el
modelo, y el modelo acaba de leer el `toolText`; esa nota después la lee un
humano y el dueño puede dictársela al entrenador, que sí escribe conocimiento.
Probabilidad baja, persistencia alta. **Acotación**: `note` se limita a 200
caracteres y se prefija **`[sistema de reservas]`** cuando el turno usó una
herramienta MCP, para que quien la lea sepa de dónde salió. No se elimina la
ruta: eliminarla exigiría prohibirle al modelo tomar notas, que es una función
del CRM.

**R-2 · Re-entrada por `stale`: una llamada ya hecha no se deshace.** Si el
turno se descarta por mensaje nuevo y se re-dispara, la llamada al PMS **ya
ocurrió** y cuenta para sus límites. Absorbido por la caché de 90 s por
`argsHash` y por el límite de 60/min, pero no eliminado.

**R-3 · Tiempo hasta la primera respuesta.** Con el re-debounce completo de 011
(que no se toca: fue una decisión explícita de esa feature y cambiarla sin datos
arriesga volver a la respuesta fragmentada que arregló) y un turno que ahora
dura 2 llamadas al modelo + hasta 10 s de red, cuatro mensajes tipeados en 25 s
pueden llevar la primera respuesta a ~56 s. **Lo que entra en v1 es medir**:
SC-005 fija un techo de 35 s y el E2E lo verifica. Si se incumple, ahí se ajusta
con evidencia, no antes.

**R-4 · Correlación entre empresas por el mismo endpoint.** Nada impide que el
super admin apunte dos organizaciones a la misma URL: el tercero ve el tráfico
de ambas y puede correlacionarlas. **Acotación**: el DTO del super admin trae
`sharedWith` y el formulario de Administración avisa cuando la URL ya existe en
la fila de otra empresa.

**R-5 · Un super admin comprometido.** Puede reapuntar el endpoint. Cambiar la
URL **borra la credencial**, así que no la cosecha en la llamada siguiente; lo
que no se puede impedir es que le pida al dueño que la vuelva a pegar. El
control que queda es que la acción es visible y requiere un humano más.

**R-6 · El Laboratorio puede ponerse rojo sin defecto real.** Mitigado por
`liveDataSection` en el prompt del juez y por la persona de alojamientos (D17).
Si aun así castiga, la corrección va en el prompt del juez, nunca en apagar la
sección.

**R-7 · Conocimiento viejo con precios.** Ningún prompt borra lo que ya está
cargado. Lo que entra es `KbConflictCard` para borrarlo a mano (D13); un barrido
automático sería destructivo.

**R-8 · Un servidor lento arrastra el turno.** Acotado por el `timeoutMs` por
empresa (default 10 s, la latencia real medida es 0,66–1,31 s) y por el deadline
de 45 s. Residual: con dos herramientas y un servidor lento, el turno consume
~20 s de los 45. El deadline corta.

**R-9 · Un solo servidor MCP por empresa.** Si el cliente de cabañas mañana
quiere además un MCP de facturación, hay que migrar a N (D4). Aditivo y trivial;
adelantarlo hoy no lo es.

**R-10 · Escrituras contra el MCP.** Fuera de alcance por dos razones
independientes: el servidor **no reserva** (devuelve enlaces) y la categoría 5
que se está escribiendo dice SOLO LECTURA. Habilitarlas sería otra enmienda y
otra feature.
