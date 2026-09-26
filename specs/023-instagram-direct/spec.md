# Feature Specification: Instagram Direct en la Bandeja

**Feature Branch**: `023-instagram-direct`

**Created**: 2026-09-25

**Status**: Draft

**Input**: Pedido del dueño (25-sep-2026): «el siguiente paso en la integración
con Meta sería poder gestionar los mensajes de una cuenta de Instagram de un
negocio». Investigación previa con el MCP de Meta y el panel:

- La app de Meta `2262662764507422` ya tiene el caso de uso «Manage messaging &
  content on Instagram» con la modalidad **API setup with Instagram login**
  armada (app de Instagram «Corscan CRM-IG», ID `2135730170674257`) y los
  permisos `instagram_business_basic` + `instagram_business_manage_messages`
  en «Ready for testing».
- Business verification y Access verification (Tech Provider) verificados.
- Para pedir Acceso Avanzado Meta exige ≥1 llamada exitosa por permiso en los
  30 días previos, un video del flujo completo y la política de privacidad al
  día.

Requiere la enmienda 1.8.0 de la constitución (Instagram como canal opcional
por empresa dentro de la categoría 1 del Principio II y del foco del VIII).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El dueño conecta la cuenta de Instagram del negocio (Priority: P1)

Como dueño de una empresa, desde Integraciones conecto la cuenta profesional
de Instagram del negocio con un clic («Conectar con Instagram»), entro con el
usuario de Instagram y acepto los permisos. Al volver al CRM veo la cuenta
conectada (@usuario y foto) y desde ese momento los mensajes directos entran
a la Bandeja.

**Acceptance Scenarios**:

1. **Given** una instancia con la app de Instagram configurada y una empresa
   sin Instagram, **When** el dueño toca «Conectar con Instagram» y autoriza,
   **Then** vuelve a Integraciones con la tarjeta en «Conectado · @usuario» y
   el CRM quedó suscripto a los mensajes de esa cuenta.
2. **Given** el dueño cancela o niega los permisos en Instagram, **When**
   vuelve al CRM, **Then** la tarjeta explica que no se conectó y permite
   reintentar; nada queda a medio guardar.
3. **Given** una cuenta de Instagram ya conectada a OTRA empresa de la
   instancia, **When** una segunda empresa intenta conectarla, **Then** se
   rechaza con un mensaje claro (una cuenta = una empresa: el webhook enruta
   por cuenta).
4. **Given** la instancia SIN la app de Instagram configurada, **When** el
   dueño abre Integraciones, **Then** la tarjeta de Instagram dice que el
   operador todavía no la habilitó y no ofrece conectar.
5. **Given** un miembro (no dueño), **When** abre Integraciones o llama a la
   API de conexión, **Then** no puede conectar ni desconectar (022).
6. **Given** una cuenta conectada, **When** el dueño toca «Desconectar» y
   confirma, **Then** se borra el token, el CRM deja de recibir mensajes de
   esa cuenta y las conversaciones ya guardadas quedan en la Bandeja.

### User Story 2 - Los mensajes directos entran a la Bandeja (Priority: P1)

Como persona del equipo, veo los mensajes de Instagram en la misma Bandeja
que WhatsApp, marcados con el ícono de Instagram, con el nombre y el
@usuario del cliente. Puedo filtrar por canal.

**Acceptance Scenarios**:

1. **Given** una cuenta conectada, **When** un cliente manda un mensaje
   directo de texto, **Then** aparece en tiempo real una conversación nueva
   con ícono de Instagram, nombre del cliente (o @usuario) y el mensaje,
   con no leídos, lead nuevo en el pipeline y notificación push.
2. **Given** el mismo mensaje reenviado por Meta (reintento del webhook),
   **When** llega de nuevo, **Then** no se duplica.
3. **Given** un cliente que manda una foto o una nota de voz, **When**
   entra, **Then** se ve la imagen o el reproductor como en WhatsApp (020) y
   el agente la tiene en cuenta; un video, archivo, reel o historia se
   muestra como adjunto con su tipo.
4. **Given** un cliente que borra un mensaje en Instagram, **When** llega el
   aviso, **Then** el CRM borra el contenido guardado y muestra «Mensaje
   eliminado por el cliente».
5. **Given** un webhook con firma inválida, **When** llega, **Then** se
   rechaza y no se guarda nada.
6. **Given** un mensaje para una cuenta que no está conectada a ninguna
   empresa, **When** llega, **Then** se ignora sin error visible para Meta.
7. **Given** la Bandeja con conversaciones de ambos canales, **When** filtro
   por «Instagram», **Then** solo veo las de Instagram.

### User Story 3 - Responder desde el CRM y desde el celular (Priority: P1)

Como persona del equipo respondo el mensaje desde el CRM y el cliente lo
recibe en Instagram. Si alguien del negocio contesta desde la app de
Instagram, esa respuesta también aparece en el hilo del CRM.

**Acceptance Scenarios**:

1. **Given** una conversación de Instagram dentro de las 24 h del último
   mensaje del cliente, **When** envío texto desde el composer, **Then** el
   mensaje sale por Instagram y queda «enviado»; cuando el cliente lo ve,
   pasa a «leído».
2. **Given** un texto de más de 1.000 caracteres, **When** lo envío,
   **Then** sale partido en varios mensajes en orden, sin cortar palabras.
3. **Given** una conversación con el último mensaje del cliente entre 24 h
   y 7 días, **When** una PERSONA envía, **Then** sale con la etiqueta de
   agente humano; si Meta la rechaza (función no aprobada), el mensaje queda
   «fallido» con el motivo en castellano.
4. **Given** más de 7 días sin mensajes del cliente, **When** abro la
   conversación, **Then** el composer explica que Instagram no permite
   escribir hasta que el cliente vuelva a escribir (no hay plantillas).
5. **Given** alguien del negocio responde desde la app de Instagram,
   **When** llega el eco, **Then** aparece en el hilo como saliente «Desde
   Instagram» y el agente no le contesta encima.
6. **Given** el eco de un mensaje que el propio CRM mandó, **When** llega,
   **Then** no se duplica.
7. **Given** el envío falla (token vencido, error de Meta), **When** ocurre,
   **Then** el mensaje queda «fallido» con motivo legible y la conexión
   pasa a «Reconectar» si fue un problema de autorización.

### User Story 4 - El agente de IA atiende Instagram (Priority: P1)

Como dueño, el mismo agente que atiende WhatsApp responde los mensajes
directos de Instagram con el mismo conocimiento, espera y reglas de
derivación.

**Acceptance Scenarios**:

1. **Given** el agente encendido, **When** un cliente escribe por
   Instagram, **Then** el agente responde dentro de la ventana, por
   Instagram, respetando la espera configurada (022).
2. **Given** la ventana de 24 h vencida, **When** el agente tendría que
   responder, **Then** no envía nada y deriva a una persona (motivo
   «ventana»); jamás usa la etiqueta de agente humano.
3. **Given** el cliente pide hablar con una persona o escribe BAJA, **When**
   entra el mensaje, **Then** se comporta igual que en WhatsApp (handoff /
   baja visible y agente mudo).
4. **Given** una respuesta del agente de más de 1.000 caracteres, **When**
   se envía, **Then** llega partida sin perder contenido.

### User Story 5 - Instagram no rompe lo que es solo de WhatsApp (Priority: P2)

Los contactos de Instagram no tienen teléfono. Nada que dependa de un
número de WhatsApp los toma.

**Acceptance Scenarios**:

1. **Given** contactos de Instagram con consentimiento `inbound`, **When**
   armo una campaña, **Then** no son elegibles ni cuentan en el total.
2. **Given** un contacto de Instagram, **When** lo veo en Contactos o en la
   ficha, **Then** se muestra @usuario (no un «teléfono» raro) y no aparece
   «Enviar plantilla».
3. **Given** la API pública `/api/v1/messages`, **When** alguien manda a un
   teléfono, **Then** jamás crea ni toca una conversación de Instagram.

### User Story 6 - La conexión no se cae sola (Priority: P2)

Como dueño no quiero tener que reconectar cada 60 días.

**Acceptance Scenarios**:

1. **Given** un token con menos de 15 días de vida, **When** corre el
   mantenimiento diario (o antes de un envío), **Then** se renueva por otros
   60 días sin intervención.
2. **Given** una renovación rechazada por Meta (permiso revocado), **When**
   ocurre, **Then** la tarjeta pasa a «Reconectar» y la Bandeja avisa en las
   conversaciones de Instagram.
3. **Given** el cliente quita la app desde Instagram o pide borrar sus
   datos, **When** Meta llama a los callbacks de desautorización o de
   eliminación, **Then** se borra el token de esa cuenta y se responde el
   código de confirmación que exige Meta.

### Edge Cases

- Un mensaje de Instagram llega para una empresa cuya conexión está en
  «Reconectar»: igual se guarda (el webhook no depende del token), pero el
  envío avisa que hay que reconectar.
- `is_self` (el negocio se escribe a sí mismo para probar): se ignora.
- Reacciones, postbacks y referencias: la reacción del cliente se guarda
  como nota en el hilo sin despertar al agente; postback/quick reply se
  ingesta como texto con su título.
- Mensajes `is_unsupported` o `ephemeral`: se muestran como «Adjunto no
  soportado por Instagram» y no despiertan al agente sin texto.
- El perfil del cliente (nombre/@usuario) no se puede leer (bloqueó al
  negocio, error de Meta): el contacto nace como «Instagram · …últimos
  dígitos» y se completa en el próximo mensaje.
- Conversaciones del Laboratorio y del Entrenador: nunca son de Instagram.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La instancia habilita Instagram solo si están
  `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET` en el entorno; sin ellas la
  tarjeta lo explica y nada más cambia.
- **FR-002**: Cada empresa conecta como máximo UNA cuenta profesional de
  Instagram por Business Login for Instagram (OAuth con `state` firmado y
  ligado a la empresa y al usuario, con vencimiento), pidiendo solo
  `instagram_business_basic` e `instagram_business_manage_messages`.
- **FR-003**: El token largo (60 días) se guarda cifrado (AES-256-GCM) con su
  vencimiento; nunca sale al cliente, a logs ni a errores.
- **FR-004**: Al conectar, el CRM suscribe la cuenta a los campos de
  mensajería (`messages`, `messaging_seen`, `messaging_postbacks`,
  `message_reactions`, `messaging_referral`) y guarda @usuario, nombre y
  foto de la cuenta.
- **FR-005**: Una cuenta de Instagram solo puede estar conectada a una
  empresa de la instancia (unique por cuenta).
- **FR-006**: El webhook de Instagram verifica el handshake con el token de
  verificación de la instancia y exige firma `X-Hub-Signature-256` válida
  con el secreto de la app de Instagram (acepta también el de la app de
  Meta) antes de procesar; responde 200 rápido y procesa en segundo plano.
- **FR-007**: La ingesta de Instagram reutiliza el embudo de WhatsApp
  (contacto, conversación `kind='instagram'`, mensaje, no leídos, lead, SSE,
  push, BAJA, turno del agente) y es idempotente por `mid` por empresa.
- **FR-008**: Los contactos de Instagram se identifican por el IGSID
  (`channel='instagram'`), sin teléfono real; muestran nombre y @usuario
  leídos del User Profile API (best effort).
- **FR-009**: Los ecos (`is_echo`) del negocio se guardan como salientes
  `source='phone'` («Desde Instagram»), sin duplicar los que mandó el CRM.
- **FR-010**: `messaging_seen` marca como leídos los salientes hasta ese
  mensaje (monotónico).
- **FR-011**: `is_deleted` borra texto, resumen y binario del mensaje y lo
  marca como eliminado.
- **FR-012**: Imagen y audio entrantes pasan por el pipeline de 020
  (descarga desde la URL de la CDN con allowlist de host, tope de tamaño,
  descripción/transcripción, agente); otros tipos se muestran con su
  etiqueta.
- **FR-013**: El envío de texto por Instagram parte en trozos ≤1.000
  caracteres, usa la ventana de 24 h, y entre 24 h y 7 días solo permite
  envíos de personas con `tag: HUMAN_AGENT`; fuera de eso bloquea.
- **FR-014**: El agente de IA atiende Instagram con las mismas guardas que
  WhatsApp y jamás envía fuera de las 24 h.
- **FR-015**: Campañas, plantillas, API pública e historial del celular
  excluyen contactos/conversaciones de Instagram.
- **FR-016**: Mantenimiento en proceso: renovación del token cuando le
  quedan <15 días (diaria y antes de enviar); si Meta la rechaza por
  autorización, estado `reconnect_required`.
- **FR-017**: Callbacks de desautorización y de eliminación de datos
  (`signed_request` firmado con el secreto de la app de Instagram): borran
  la conexión de esa cuenta y responden `{url, confirmation_code}`.
- **FR-018**: Mocks de desarrollo (`/api/dev/ig-mock`, 404 en producción)
  que simulan OAuth, perfil, envío, suscripción y webhooks entrantes
  firmados, para el self-test E2E.
- **FR-019**: Solo el dueño conecta/desconecta (withOwner); los miembros
  operan las conversaciones.

### Key Entities

- **instagram_integration** (nueva, 1 por empresa): `ig_user_id` (unique
  instancia), `username`, `name`, `profile_picture_url`, token cifrado,
  `token_expires_at`, `token_refreshed_at`, `status`
  (`connected`/`reconnect_required`), `connected_by`, timestamps.
- **contact** (cambia): `channel` (`whatsapp` default / `instagram`),
  `ig_user_id` (IGSID) y `ig_username`; para Instagram `phone` guarda el
  valor sintético `ig:<IGSID>` (mismo patrón que el contacto sintético del
  Entrenador) para no romper el unique ni los consumidores del teléfono.
- **conversation** (cambia): `kind` suma `instagram`.
- **message** (sin columnas nuevas): `wa_message_id` guarda el `mid` de
  Instagram (id del proveedor, unique por empresa); `type='deleted'` para
  borrados.

## Success Criteria *(mandatory)*

- **SC-001**: Con los mocks, el guion E2E conecta una cuenta, recibe texto e
  imagen, responde como persona y como agente, recibe un eco y un «visto», y
  desconecta — todo observable en la UI, sin duplicados.
- **SC-002**: Camino infeliz: firma inválida, token vencido al enviar,
  ventana vencida y Meta caído degradan con mensajes claros sin tumbar la
  ingesta ni el turno.
- **SC-003**: En producción, con la cuenta `@corscan.ing` (Standard
  Access), un mensaje real entra a la Bandeja y una respuesta sale desde el
  CRM: eso deja registradas las llamadas exitosas de ambos permisos para el
  App Review.
- **SC-004**: Gate técnico verde (typecheck, lint, build, unit) sin romper
  ningún test existente.

## Assumptions

- Instagram Login (no Facebook Login): el cliente no necesita una Página de
  Facebook. Decisión tomada con el dueño el 25-sep-2026.
- Sin envío de imágenes/archivos salientes por Instagram en esta feature (el
  composer de WhatsApp tampoco los envía hoy).
- Sin comentarios, menciones ni publicación de contenido (fuera del foco).
- El secreto de la app de Instagram lo carga el dueño en Railway; ningún
  secreto pasa por el chat.
