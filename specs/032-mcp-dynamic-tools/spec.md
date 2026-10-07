# 032 — Herramientas del conector sin deploy, y reservas por WhatsApp

Pedido del dueño (7-oct-2026). El servidor MCP de «Altos de Calamuchita»
(versión 2.0.0) sumó cuatro herramientas para **iniciar una reserva y
devolver el enlace de pago de la seña**: `start-booking`,
`set-guest-details`, `show-booking-draft` y `confirm-booking`. El dueño
reconectó el conector y las vio en Integraciones, pero el agente no las podía
usar. La lista de herramientas permitidas (`ALLOWED_TOOLS`) estaba fija en el
código del perfil, la regla «este negocio no toma reservas por WhatsApp»
estaba escrita en el prompt y el Entrenador no veía el conector, así que
contestaba «pegame las instrucciones».

Objetivo del dueño, textual: «que quede como un mecanismo que no haga falta
deployar una nueva versión. Que solo con reconectar baste para incorporar las
herramientas, con este y con cualquier MCP».

## Decisiones del dueño (7-oct-2026)

| Tema | Decisión |
|---|---|
| Herramientas nuevas al reconectar | Las que el servidor declara de **solo lectura** quedan activas solas; las que **escriben** quedan «pendiente de aprobar» y se activan con un clic. |
| Quién aprueba una que escribe | **Super admin o propietario** de la empresa. |
| Importes (regla 021 «nunca escribir importes») | Siguen ocultos, **salvo el total y la seña del resumen de la reserva** que el interesado tiene que ver para confirmar. |
| ¿El agente ofrece reservar o espera a que se lo pidan? | **Lo decide el cliente con el Entrenador.** Por defecto rige lo que dicen las instrucciones del servidor. |
| Enmienda de la constitución | Aprobada («dale, arrancá la 032»): el conector deja de ser SOLO LECTURA en las condiciones de abajo. |

## Hechos del servidor real (relevados el 7-oct-2026, sin credencial)

- `tools/list` y `initialize` responden sin credencial; `tools/call` la exige.
- Siete herramientas: las tres de siempre y las cuatro de reserva. Las
  anotaciones: `start-booking` declara `readOnlyHint:true` sin
  `idempotentHint`; `set-guest-details` y `show-booking-draft` declaran
  `readOnlyHint:true, idempotentHint:true`; `confirm-booking` declara
  `readOnlyHint:false, idempotentHint:false, destructiveHint:false`.
- `instructions` del `initialize`: **16,5 KB** con el flujo completo (orden,
  seis datos obligatorios —nombre y apellido, correo, DNI, celular, ciudad y
  provincia—, aceptación de términos con `terms.url`, resumen con total y
  seña antes de confirmar, errores estables `draft_not_found`,
  `invalid_guest_field`, `missing_guest_data`, `terms_not_accepted`,
  `not_confirmed`, `no_longer_available`, `min_stay_not_met`). Hoy se
  guardan recortadas a 1.500 caracteres.
- `confirm-booking` exige `confirmed:true` como «conformidad explícita del
  interesado» y advierte: «no reintentar después de un éxito: registraría una
  segunda reserva».
- La reserva queda **pendiente de seña** y vence sola; el servicio no cobra
  ni confirma pagos.

## Objetivos

1. **Lo que publica el servidor es la fuente de verdad.** Al reconectar
   («Verificar conexión») se relee `tools/list` e `instructions`, y lo que
   haya —en este o en cualquier MCP— queda disponible para el agente sin
   tocar el código, con un control humano por herramienta.
2. **El perfil pasa a ser una optimización, no un techo.** Las herramientas
   que el perfil sabe condensar (`search_stays`/`show_stay` en Altos) siguen
   por su camino; cualquier otra habilitada se usa por un camino genérico.
3. **Reservas por WhatsApp en Altos** con los mismos cuidados que el
   formulario del sitio y una barrera propia del CRM antes de escribir.
4. **El Entrenador sabe qué herramientas tiene el agente** y las explica.

## Historias y criterios

### US1 — Herramientas que se suman solas al reconectar

- AC1.1 «Verificar conexión» guarda de cada herramienta: nombre, título,
  descripción, esquema de parámetros (`inputSchema`) y anotaciones, saneados
  y acotados. Las `instructions` se guardan hasta **24.000** caracteres.
- AC1.2 Cada herramienta tiene un **modo efectivo**:
  - **Consulta** (`readOnlyHint:true`): activa por defecto; se puede apagar.
  - **Escritura** (cualquier otra): **pendiente de aprobar** por defecto;
    la activa el super admin o el propietario, con un diálogo que explica
    qué implica.
  - Si una herramienta de escritura **cambia su definición** (descripción,
    parámetros o anotaciones) en un handshake posterior, su aprobación
    **vuelve a pendiente**.
  - Las herramientas que **usa el perfil** (Altos: `list-search-options`,
    `check-availability`, `show-property`) figuran como «la usa el perfil»
    y no tienen interruptor propio (las gobierna «Herramientas del agente»).
- AC1.3 Una herramienta que desaparece de `tools/list` deja de ofrecerse al
  agente en el turno siguiente; si vuelve, recupera su decisión anterior
  (salvo que haya cambiado, ver AC1.2).
- AC1.4 Con perfil `generic` (cualquier MCP sin perfil), las herramientas
  activas SÍ llegan al agente. Antes no recibía ninguna.
- AC1.5 El interruptor «Herramientas del agente» de la empresa sigue
  apagando TODO (perfil y genéricas).
- AC1.6 El super admin ve y decide lo mismo desde Administración → empresa →
  Conector MCP, sin entrar como la empresa.

### US2 — El agente usa las herramientas genéricas

- AC2.1 Contrato nuevo: `{"action":"use_tool","tool":"<nombre>","args":{…}}`
  (acepta `lead_note`). Solo se ofrece con al menos una herramienta genérica
  activa y el conector `connected`.
- AC2.2 El prompt suma la sección **HERRAMIENTAS DEL SISTEMA DE {rótulo}**:
  por herramienta, el nombre, si es consulta o escritura y la descripción
  del proveedor, con sus parámetros resumidos. Además, si la empresa activó
  «Usar las notas del proveedor», van las `instructions` completas (hasta
  24.000 caracteres). Todo encerrado en la valla con nonce, como DATO.
- AC2.3 **Memoria de herramientas de la conversación**: el prompt incluye
  las últimas llamadas a herramientas genéricas de ESA conversación
  (herramienta, argumentos y un extracto del resultado). Con eso, el
  `draft_id` y lo que ya se cargó sobreviven entre turnos y la reserva se
  retoma si el interesado vuelve al otro día.
- AC2.4 Antes de llamar se validan los argumentos contra el `inputSchema`
  (tipos, requeridos, enum; enteros que llegan como texto se convierten).
  Un argumento inválido NO gasta una llamada: el modelo recibe qué corregir.
  Si el esquema declara `conversation_id`, el CRM lo completa con el id de
  la conversación (atribución del lead, igual que el perfil).
- AC2.5 El resultado vuelve al modelo como `[HERRAMIENTA]`, saneado, como
  JSON compacto acotado a 6.000 caracteres. Los enlaces de hosts fuera de la
  allowlist del perfil más el host del endpoint se reemplazan por
  «[enlace omitido]». Los errores del proveedor vuelven con su código y sus
  campos estructurados (`field`, `label`, `missing_labels`…) para que el
  modelo se corrija.
- AC2.6 Una herramienta del perfil pedida por `use_tool` no se llama: el
  modelo recibe «usá search_stays / show_stay».
- AC2.7 Nada de esto lanza: un fallo de transporte degrada igual que hoy
  (texto propio, evento en el hilo, handoff si no queda nada que decir).

### US3 — Barrera de escritura (la pone el CRM, no el modelo)

- AC3.1 Una herramienta de escritura solo se ejecuta si está **aprobada**.
- AC3.2 **Conformidad del interesado**: el último mensaje del cliente (el
  posterior a la última respuesta del agente) tiene que ser una conformidad
  explícita («sí», «dale», «confirmo», «de acuerdo», «perfecto, avanzá»…),
  sin negación ni duda («no», «todavía no», «esperá», «¿cuánto…?»). Si no,
  la llamada NO sale y el modelo recibe: «mostrale el resumen y preguntale
  si confirma; cuando diga que sí, volvé a pedirla».
- AC3.3 **Una sola vez**: la misma escritura con los mismos argumentos que ya
  salió bien en esa conversación no se repite; el modelo recibe el resultado
  guardado. Las escrituras nunca salen de la caché ni se reintentan solas.
- AC3.4 Como máximo **una escritura por turno**.
- AC3.5 **Laboratorio y Entrenador**: jamás tocan el sistema real; el modelo
  recibe una respuesta simulada y rotulada como simulación.
- AC3.6 Una escritura exitosa deja un **evento en el hilo** («El agente
  registró en {rótulo}: {título de la herramienta}») y una nota en el lead.

### US4 — Altos: reservas sin contradicciones

- AC4.1 Con alguna herramienta de escritura activa, la sección de Altos
  cambia la regla «ESTE NEGOCIO NO TOMA RESERVAS POR WHATSAPP» por «podés
  dejar la reserva iniciada con las herramientas del sistema; nunca digas
  que quedó registrada si la herramienta no lo confirmó».
- AC4.2 **Importes**: siguen ocultos. Se permiten SOLO los importes que una
  herramienta genérica devolvió en ESTE turno (el resumen de la reserva:
  total y seña). Un importe inventado o de la búsqueda se sigue recortando.
- AC4.3 **Guarda de promesas**: con escritura activa no bloquea ofrecer la
  reserva («¿querés que te la deje iniciada?»), pero SIGUE bloqueando
  afirmar que quedó registrada/confirmada si en ese turno no salió bien una
  escritura.
- AC4.4 El enlace de pago y el de términos llegan al cliente (host del
  endpoint, en la allowlist).

### US5 — El Entrenador conoce las herramientas

- AC5.1 El prompt del Entrenador incluye el conector: rótulo, estado, cada
  herramienta con su modo (activa, pendiente, apagada) y, si están
  activadas, las notas del proveedor resumidas.
- AC5.2 A «actualicé las herramientas, ¿podés fijarte?» responde con lo que
  ve, sin pedir que le peguen nada; si una escritura está pendiente, dice
  dónde se aprueba.
- AC5.3 Lo que el dueño le enseñe sobre cómo usarlas (ofrecer la reserva o
  esperar, en qué orden pedir los datos) se guarda como conocimiento o
  perfil, igual que hoy.

## Fuera de alcance

- Cobrar, registrar pagos o confirmar reservas (el servidor tampoco lo hace).
- Recursos y prompts de MCP (`resources/*`, `prompts/*`): solo herramientas.
- Persona nueva del Laboratorio para el flujo de reserva (queda anotada).
- MiniHotel: su transporte no publica `tools/list`; sigue con su perfil.

## Riesgos y mitigaciones

- **Que el servidor mienta en `readOnlyHint`**: la URL la fija solo el super
  admin (proveedor de confianza); cualquier herramienta se puede apagar; un
  cambio de definición de una de escritura vuelve a pedir aprobación.
- **Inyección en descripciones e instrucciones**: saneo + valla con nonce +
  rol `user` para los resultados (igual que 016); las reglas duras del
  prompt prevalecen.
- **Doble reserva**: idempotencia por conversación y argumentos, sin caché
  ni reintentos para las escrituras.
- **Costo de tokens**: hasta ~24 KB de instrucciones más las descripciones.
  Solo se incluyen con «Usar las notas del proveedor» activado, y la UI
  muestra el tamaño.
