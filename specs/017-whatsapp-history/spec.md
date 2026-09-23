# Feature Specification: Historial del celular (coexistence) en la Bandeja

**Feature Branch**: `017-whatsapp-history`

**Created**: 2026-09-23

**Status**: Draft

**Input**: Pedido del dueño (23-sep-2026): «El agente responde como si
fuera un cliente nuevo a gente que ya es cliente o a proveedores con
semanas de conversación. Cuando el negocio se suma al CRM, la
conversación arranca de cero pero ya había historial en el celular. El
número está en coexistence: arrancá con la importación de 60 días
inicialmente, no hace falta 180. El que vuelve a los 6 meses, que se
comporte como nuevo por ahora.»

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Importar el historial del celular (Priority: P1)

Como propietario con el número conectado en coexistence, en Ajustes →
WhatsApp toco «Importar historial del celular». El CRM le pide a Meta la
sincronización y, a medida que llegan los chats, aparecen en la Bandeja
en su fecha real: contactos, conversaciones y mensajes de los últimos 60
días, con lo que mandé yo desde el celular y lo que me escribieron. Veo
el progreso y cuántos mensajes entraron. Nada de eso dispara al agente,
no infla los no leídos, no crea leads ni notificaciones, y no cambia la
ventana de 24 h salvo que haya un mensaje del cliente reciente de verdad.

**Why this priority**: es la base para que el agente y el operador no
arranquen de cero con clientes de siempre.

**Independent Test**: con el wa-mock, pedir la importación → dos
webhooks `history` (desordenados) + uno de media → la Bandeja muestra
las conversaciones con los mensajes en orden cronológico, los más viejos
que 60 días quedan afuera y la tarjeta marca 100 %.

**Acceptance Scenarios**:

1. **Given** un número conectado, **When** toco «Importar historial»,
   **Then** el CRM llama a Meta (`smb_app_data`, contactos + historial), la
   tarjeta pasa a «Solicitado» y luego «Recibiendo… N %».
2. **Given** llegan webhooks `history` con dos hilos, **When** se
   procesan, **Then** cada hilo crea o reutiliza el contacto y su
   conversación, cada mensaje se inserta una sola vez (por `wamid`) con su
   fecha original, dirección según el remitente y estado según
   `history_context`, y los mensajes anteriores a 60 días se descartan.
3. **Given** un chunk 2 llega antes que el chunk 1, **When** ambos se
   procesan, **Then** el hilo queda en orden cronológico igual.
4. **Given** un mensaje de media, **When** llega el placeholder y luego el
   detalle, **Then** el hilo muestra «Archivo del celular» y, si llega el
   detalle, el tipo y el pie.
5. **Given** la importación, **When** termina (progreso 100), **Then** la
   tarjeta muestra «Importado: N mensajes en M conversaciones».
6. **Given** el negocio rechazó compartir el historial, **When** llega el
   error 2593109, **Then** la tarjeta lo explica y ofrece reintentar tras
   activarlo en la app.
7. **Given** una conversación con no leídos y ventana abierta, **When** se
   importan mensajes viejos suyos, **Then** los no leídos y la ventana no
   cambian, no se crean leads ni se envían push, y el agente no responde.
8. **Given** el onboarding por Embedded Signup en coexistence, **When**
   termina, **Then** la importación se pide sola (ventana de 24 h de Meta).

---

### User Story 2 - Lo que mando desde el celular se ve en el CRM (Priority: P1)

Como propietario que sigue usando WhatsApp en el celular, cuando le
respondo a un cliente desde la app, ese mensaje aparece en la Bandeja
como saliente «desde el celular», y el agente no le contesta encima de
mí a ese mismo mensaje.

**Independent Test**: wa-mock entrega un `smb_message_echoes` → burbuja
saliente con la etiqueta; un entrante seguido de un eco no produce
respuesta del agente.

**Acceptance Scenarios**:

1. **Given** un eco de un mensaje que mandé desde el celular, **When**
   llega, **Then** se persiste como saliente (una sola vez por `wamid`),
   con etiqueta «Desde el celular», y el hilo se actualiza en vivo.
2. **Given** un cliente escribió y yo respondí desde el celular antes de
   que el agente hable, **When** vence el debounce, **Then** el agente
   no responde (lo último de la conversación ya es del negocio).

---

### User Story 3 - Nombres de la agenda del celular (Priority: P2)

Como propietario, los contactos que el CRM creó con el nombre de perfil
de WhatsApp (o con el número) toman el nombre con el que los tengo en mi
agenda, sin pisar nombres que ya edité en el CRM.

**Acceptance Scenarios**:

1. **Given** un contacto cuyo nombre es su número o su perfil de
   WhatsApp, **When** llega `smb_app_state_sync` con su nombre de agenda,
   **Then** el contacto se renombra; **Given** un contacto importado o
   creado a mano, **Then** conserva su nombre.

### Edge Cases

- Meta no permite acotar el período: manda hasta 180 días en fases; el
  CRM filtra por fecha al ingerir (60 por defecto, 1..180 por pedido).
- La sincronización se pide fuera de las 24 h del onboarding: Meta la
  rechaza; la tarjeta muestra el error y explica que hay que reconectar.
- Un webhook puede traer miles de mensajes: se responde 200 de inmediato
  y se procesa después (ya es así), en lotes.
- Grupos, llamadas, listas de difusión y mensajes temporales no vienen.
- Media anterior a 14 días no trae detalle: queda como «Archivo del
  celular».
- Mensajes de hilos con `wa_id` que no es un teléfono válido se ignoran.
- El mismo `wamid` en dos empresas distintas no colisiona (índice por
  tenant).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El webhook MUST procesar los campos `history`,
  `smb_message_echoes` y `smb_app_state_sync` por empresa (ruteo por
  `phone_number_id`), sin afectar a los demás campos.
- **FR-002**: `POST /api/settings/whatsapp/history-import` (owner) MUST
  pedir a Meta `smb_app_state_sync` y `history` y registrar el estado
  por empresa (`history_import`: solicitado, recibiendo, hecho, fallido,
  rechazado; días; progreso; contadores; último error).
- **FR-003**: La ingesta del historial MUST insertar los mensajes con
  `created_at = timestamp` original, `source='history'`, dirección por
  remitente, estado por `history_context`, dedup por `(org, wamid)`,
  y descartar los anteriores a `días`.
- **FR-004**: La ingesta del historial MUST NOT incrementar no leídos,
  crear leads, evaluar opt-out, notificar push ni disparar al agente; y
  MUST actualizar `last_message_at`/`last_inbound_at` solo hacia adelante
  (`greatest`).
- **FR-005**: Los ecos MUST persistirse como salientes `source='phone'`,
  con SSE en vivo, dedup por `wamid`, sin disparar al agente.
- **FR-006**: El agente de clientes MUST NOT responder si el último
  mensaje de la conversación es del negocio.
- **FR-007**: Los nombres de `smb_app_state_sync` MUST aplicarse solo a
  contactos cuyo nombre es el teléfono o el perfil de WhatsApp.
- **FR-008**: Al completar el onboarding en coexistence, el CRM MUST
  pedir la sincronización automáticamente (mejor esfuerzo).
- **FR-009**: Ajustes → WhatsApp MUST mostrar la tarjeta «Historial del
  celular» con estado, progreso, contadores, errores y el botón.
- **FR-010**: El hilo MUST etiquetar los salientes del celular y mostrar
  los placeholders de media como «Archivo del celular».
- **FR-011**: Fuera de v1: descarga de media del historial, memoria de
  relación a largo plazo, pausa automática del agente cuando el dueño
  interviene desde el celular.

### Key Entities

- **history_import**: `organization_id` PK, `status`, `days`,
  `request_id`, `requested_at`, `last_chunk_at`, `finished_at`,
  `progress`, `imported_messages`, `skipped_old`, `threads`,
  `last_error_code`, `last_error`.
- **message**: + `source` (`cloud` | `history` | `phone`).

## Success Criteria *(mandatory)*

- **SC-001**: Tras importar, un cliente de hace tres semanas aparece en
  la Bandeja con su charla completa en orden, y el agente la ve en su
  ventana de contexto.
- **SC-002**: Lo que el dueño manda desde el celular se ve en el CRM en
  segundos y el agente no lo pisa.
- **SC-003**: La importación nunca produce respuestas del agente, push ni
  leads espurios.
- **SC-004**: Gate técnico verde + guion `tests/e2e/017-whatsapp-history.md`
  en verde con wa-mock (feliz + infeliz).

## Assumptions

- El número de la empresa está onboardeado en coexistence y el negocio
  aprobó compartir el historial; la sincronización se pide dentro de las
  24 h del onboarding (para el número actual, si Meta la rechaza, hay que
  reconectar el número por Embedded Signup).
- Constitución II: sin dependencia nueva (misma Cloud API). III: todo por
  `organization_id`. IV: dedup por `wamid` por tenant.
