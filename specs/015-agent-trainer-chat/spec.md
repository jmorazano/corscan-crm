# Feature Specification: Entrenar al agente conversando desde la Bandeja

**Feature Branch**: `015-agent-trainer-chat`

**Created**: 2026-09-21

**Status**: Draft

**Input**: Pedido del dueño (21-sep-2026): «Tenemos que agregar la
funcionalidad de que el usuario pueda enseñarle al agente de una manera
conversacional. Hoy mi cliente lo hace por Telegram: le da instrucciones a
un open claw que anota esas enseñanzas como parte de su contexto para
contestar por WhatsApp. Los dueños del negocio no tienen la costumbre de
sentarse a llenar formularios; les resulta más conveniente mandar un
mensaje o un audio con indicaciones para corregir el conocimiento o
transmitir enseñanzas después de casos inesperados. Si la compañía tiene un
token válido de OpenRouter, que se active una conversación en la bandeja de
entrada con su propio agente del CRM, al cual pueda transmitirle esas
enseñanzas y que el agente las traduzca a la base de conocimientos. El
panel lateral derecho de esa conversación tiene otras funcionalidades que
las de un contacto de WhatsApp.» Decisiones cerradas el 21-sep: el agente
APLICA los cambios directamente y responde qué cambió, con historial y
«Deshacer» (sin paso de confirmación; pregunta solo si es ambiguo); puede
modificar conocimiento Y comportamiento (tono, instrucciones, escalado,
saludo, nombre); las notas de voz son la última historia (P3) y se
transcriben por el mismo proveedor OpenRouter (modelo multimodal), sin
servicio externo nuevo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enseñarle al agente por texto, con aplicación directa (Priority: P1)

Como dueño del negocio, cuando mi empresa tiene la IA configurada, veo en
la Bandeja una conversación fija arriba de todo con mi propio agente
(«Entrená a Ari»). Le escribo como si fuera un empleado: «cuando pregunten
por precio de mensura decí que arranca en 150 mil», «no uses emojis»,
«escalá si piden factura A». El agente guarda eso en su conocimiento o en
su comportamiento en el mismo turno y me responde en una o dos frases qué
guardó. Si lo que digo es ambiguo, me hace UNA pregunta concreta en vez de
inventar. Lo que le enseño lo usa de inmediato con los clientes de
WhatsApp.

**Why this priority**: es el valor de la feature: reemplaza el formulario
por una conversación.

**Independent Test**: con ai-mock, escribir una enseñanza de precio →
aparece una P/R nueva en Agente marcada «desde el chat» y un cliente por
wa-mock recibe una respuesta cuyo prompt ya la incluye.

**Acceptance Scenarios**:

1. **Given** una empresa con token de OpenRouter guardado, **When** abro
   la Bandeja, **Then** veo una fila fija arriba «Entrená a {nombre del
   agente}» sin teléfono, que no cuenta en el total de conversaciones.
2. **Given** la conversación abierta, **When** escribo «cuando pregunten
   por precio de mensura decí que arranca en 150 mil», **Then** mi mensaje
   aparece a la derecha sin ticks de entrega, veo «{nombre} está
   pensando…» y luego la respuesta del agente a la izquierda con el chip
   IA confirmando qué guardó; Agente → Knowledge base muestra la nueva P/R.
3. **Given** una P/R ya existente sobre el precio de mensura, **When** le
   digo un precio distinto, **Then** el agente ACTUALIZA esa entrada en vez
   de duplicarla.
4. **Given** la conversación, **When** escribo «no uses emojis», **Then** el
   tono del agente termina en «- No usar emojis.» y la respuesta lo confirma.
5. **Given** una indicación incompleta («cambiá el precio»), **When** la
   envío, **Then** el agente responde con una pregunta y no cambia nada.
6. **Given** dos mensajes míos seguidos, **When** los mando en ráfaga,
   **Then** recibo exactamente una respuesta que los cubre a ambos.
7. **Given** el proveedor de IA caído, **When** escribo, **Then** el agente
   responde «No pude procesar eso ahora…», la conversación no escala a
   humano y sigue operable.
8. **Given** el agente respondió mientras yo no estaba en el hilo, **When**
   miro la pestaña Bandeja, **Then** el badge de no leídos suma esa
   respuesta y vuelve a cero al abrir el hilo.
9. **Given** que el propietario borra el token de OpenRouter, **When** se
   recarga la Bandeja, **Then** la fila desaparece y mandar un mensaje a
   esa conversación responde 409 `ai_not_configured`; al volver a
   configurarlo reaparece con su historial.
10. **Given** una búsqueda, un filtro de etiquetas o «No leídas» sin
    pendientes, **When** se aplican, **Then** la fila fija se oculta.

---

### User Story 2 - Ver los cambios aplicados y deshacerlos (Priority: P2)

Como dueño, en el panel derecho de esa conversación (no es la ficha de un
contacto) veo el estado del agente (nombre, encendido o apagado, modelo en
uso, tamaño del conocimiento) y la lista de cambios recientes que el agente
aplicó: qué se agregó, actualizó o borró y cuándo. Cada cambio tiene
«Deshacer»; al deshacerlo el conocimiento vuelve a como estaba y el hilo lo
deja asentado. También puedo vaciar la conversación sin perder los cambios.

**Why this priority**: la aplicación directa solo es aceptable si es
visible y reversible.

**Independent Test**: enseñar un precio, deshacerlo desde el panel → la
entrada desaparece de `/api/kb` y el hilo muestra «Deshice: …»; un segundo
intento responde 409.

**Acceptance Scenarios**:

1. **Given** un cambio aplicado, **When** abro el panel, **Then** veo su
   resumen («Nueva P/R: …»), la hora y el botón «Deshacer».
2. **Given** un cambio de tipo alta, **When** lo deshago, **Then** la
   entrada se borra; **Given** una actualización, **Then** vuelve el texto
   anterior; **Given** un borrado, **Then** la entrada se restaura con su
   mismo id; **Given** un cambio de comportamiento, **Then** el campo
   vuelve a su valor anterior.
3. **Given** un cambio ya deshecho, **When** intento deshacerlo de nuevo,
   **Then** el botón no está y la API responde 409 `already_reverted`.
4. **Given** el panel en móvil (375 px), **When** lo abro con `?d=1`,
   **Then** ocupa la pantalla, permite deshacer y vuelve con «atrás».
5. **Given** Agente → Knowledge base, **When** listo las entradas, **Then**
   las creadas por chat llevan el chip «desde el chat».

---

### User Story 3 - Enseñarle con una nota de voz (Priority: P3)

Como dueño, desde el teléfono (app instalada) toco el micrófono en la
conversación con mi agente, hablo hasta tres minutos y envío. Veo mi audio
con un reproductor, «Transcribiendo…» y luego la transcripción; el agente
responde y aplica cambios igual que si lo hubiera escrito. En escritorio
puedo adjuntar un archivo de audio en lugar de grabar.

**Why this priority**: es la forma en que el cliente enseña hoy por
Telegram; depende de US1 y de un modelo con entrada de audio.

**Independent Test**: adjuntar un `.wav` de prueba → burbuja de audio,
transcripción del ai-mock y respuesta del agente; un `.txt` es rechazado.

**Acceptance Scenarios**:

1. **Given** la conversación del entrenador, **When** el campo de texto
   está vacío, **Then** el botón de enviar es un micrófono; al tocarlo
   pide permiso, muestra el tiempo transcurrido y «detener y enviar».
2. **Given** una nota enviada, **When** llega al hilo, **Then** aparece con
   reproductor y «Transcribiendo…», luego la transcripción bajo el audio y
   después la respuesta del agente.
3. **Given** un audio sin habla reconocible, **When** se transcribe,
   **Then** la burbuja dice «(audio sin contenido reconocible)» y el agente
   no responde.
4. **Given** un modelo de transcripción sin entrada de audio, **When** se
   intenta, **Then** la burbuja explica el error y remite a Ajustes → IA.
5. **Given** un archivo que no es audio o supera 8 MB, **When** lo adjunto,
   **Then** se rechaza antes de enviarlo (y la API responde 415/413).
6. **Given** Ajustes → Inteligencia artificial, **When** lo abro, **Then**
   puedo elegir el modelo de transcripción (default con entrada de audio).
7. **Given** el permiso de micrófono denegado, **When** toco el micrófono,
   **Then** veo cómo habilitarlo y sigo pudiendo adjuntar un archivo.

### Edge Cases

- El dueño le pide algo que no es una enseñanza («¿qué sabés de mensuras?»):
  el agente responde con lo que sabe, sin cambios.
- Le pide borrar «la entrada del precio» y hay varias: pregunta cuál.
- El conocimiento supera el umbral de aviso (24.000 caracteres): el agente
  prefiere actualizar o fusionar antes que agregar.
- El modelo devuelve más de 10 cambios o uno inválido (P/R sin respuesta):
  se aplican los válidos y la respuesta informa cuántos no pudo guardar.
- El agente cambia su propio nombre: la fila y el header se actualizan.
- Alguien borra la conversación o el contacto sintético: prohibido (409).
- Un import o la API pública intentan crear el contacto sintético: el
  teléfono `trainer` no es un wa_id válido → rechazado.
- La conversación del entrenador jamás llega a la API de WhatsApp (doble
  guardrail: `is_test` y `kind`).
- El seed demo borra el knowledge base: los cambios viejos responden 409
  `target_conflict` al deshacerse.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Toda empresa con credenciales de IA guardadas MUST tener una
  única conversación de tipo `trainer` con un contacto sintético
  (teléfono `trainer`, archivado, `is_test`), creada de forma perezosa e
  idempotente al listar la Bandeja.
- **FR-002**: La Bandeja MUST mostrar esa conversación fija arriba, fuera
  de la paginación y del total, oculta bajo búsqueda o etiquetas y bajo
  «No leídas» sin pendientes; el badge de la pestaña MUST contar sus no
  leídos.
- **FR-003**: Los mensajes del dueño MUST persistirse como salientes sin
  ticks; las respuestas del agente como entrantes generados por IA que
  incrementan los no leídos.
- **FR-004**: `POST /api/conversations/[id]/messages` sobre una conversación
  `trainer` MUST insertar el mensaje y disparar el turno del entrenador de
  inmediato, sin el debounce del agente de clientes, con un lock por
  conversación que garantiza UNA respuesta por ráfaga.
- **FR-005**: El turno MUST usar un prompt y un contrato de acciones
  propios (`reply` | `apply{changes, reply}`), con el perfil y el
  conocimiento actuales (con ids) y las reglas: aplicar en el mismo turno,
  actualizar antes que duplicar, preguntar si es ambiguo, no inventar.
- **FR-006**: Los cambios MUST aplicarse en una transacción a través de un
  servicio compartido de knowledge base y perfil, con límites idénticos a
  los de las rutas existentes y coherencia `kind`↔campos (también para
  `PATCH /api/kb/[id]`).
- **FR-007**: Cada cambio MUST quedar registrado (`agent_change`) con
  antes/después y un resumen legible; las entradas del conocimiento MUST
  registrar su origen (`manual` | `lab` | `trainer`).
- **FR-008**: Deshacer MUST restaurar el estado anterior de forma
  idempotente (409 si ya fue revertido, 409 si el objetivo ya no existe) y
  dejar un mensaje «Deshice: …» en el hilo.
- **FR-009**: Un fallo del proveedor MUST producir una respuesta amable del
  agente, sin handoff ni excepción; la conversación sigue operable.
- **FR-010**: El agente de clientes MUST ignorar conversaciones `trainer`;
  el sender real MUST rechazarlas (`sandbox_violation`); no se envían
  notificaciones push por ellas; campañas, pipeline, contactos y facets
  MUST excluir el contacto sintético.
- **FR-011**: Sin credenciales de IA la conversación MUST dejar de listarse
  (se conserva) y sus mensajes MUST responder 409 `ai_not_configured`.
- **FR-012**: El panel derecho de la conversación `trainer` MUST mostrar
  estado del agente, modelo, tamaño del conocimiento y los cambios
  recientes con «Deshacer», y permitir vaciar el hilo.
- **FR-013** (US3): Las notas de voz MUST grabarse en el navegador en un
  formato aceptado por el proveedor (m4a/ogg/wav, nunca webm), guardarse
  en Postgres (≤ 8 MB, ≤ 3 min) y servirse solo autenticadas con soporte
  de `Range`.
- **FR-014** (US3): La transcripción MUST hacerse por el adaptador
  OpenRouter con un modelo de transcripción por empresa (default con
  entrada de audio) y entrar al turno como texto; vacío, formato no
  soportado y fallo del proveedor MUST degradar con mensaje claro y sin
  turno.
- **FR-015**: Fuera de v1: entrenar desde el propio WhatsApp del dueño,
  propuestas con confirmación previa, transcripción de audios de clientes,
  edición de bloques desde el panel, notificaciones push del entrenador.

### Key Entities

- **conversation**: + `kind` (`whatsapp` | `trainer`), índice único parcial
  por empresa para `trainer`; `is_test` pasa a significar «sandbox».
- **contact** sintético: `phone='trainer'`, `is_test`, archivado, nombre =
  nombre del agente.
- **kb_entry**: + `source` (`manual` | `lab` | `trainer`).
- **agent_change**: `organization_id`, `conversation_id`, `message_id`,
  `source`, `op` (`kb_add` | `kb_update` | `kb_delete` | `profile_update`),
  `target_id`, `before`, `after` (jsonb), `summary`, `reverted_at`,
  `reverted_by`, `created_at`.
- **message_media** (US3): blob del audio 1:1 con el mensaje, `mime_type`,
  `size_bytes`, `duration_ms`.
- **ai_credentials**: + `transcription_model` (US3).

## Success Criteria *(mandatory)*

- **SC-001**: Una enseñanza escrita en lenguaje natural queda en el
  conocimiento o en el comportamiento en un solo turno, sin abrir Agente.
- **SC-002**: Un cliente por WhatsApp recibe una respuesta que usa la
  enseñanza en la primera conversación posterior.
- **SC-003**: Todo cambio aplicado por chat es visible y reversible desde
  el panel en un click, y deshacerlo dos veces es inocuo.
- **SC-004**: Una nota de voz de prueba termina en transcripción y
  respuesta del agente; los archivos inválidos se rechazan antes de subir.
- **SC-005**: Gate técnico verde + guiones `tests/e2e/015-agent-trainer.md`
  y `tests/e2e/015-trainer-audio.md` en verde con wa-mock + ai-mock
  (feliz + infeliz, escritorio y 375 px).

## Assumptions

- Cualquier miembro de la empresa puede entrenar (mismo criterio que hoy
  para editar Agente).
- Constitución II: sin dependencia externa nueva; la transcripción usa el
  mismo proveedor OpenRouter-compatible (categoría 2). Sin bump.
- Constitución III: todas las tablas nuevas llevan `organization_id`.
- La grabación real con micrófono no puede conducirse en el Browser pane:
  queda «pendiente de verificación humana» en el teléfono del dueño; el
  camino por archivo sí se verifica de punta a punta.
