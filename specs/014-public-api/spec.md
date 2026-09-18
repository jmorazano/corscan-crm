# Feature Specification: API pública por empresa para envíos programáticos

**Feature Branch**: `014-public-api`

**Created**: 2026-09-18

**Status**: Draft

**Input**: Pedido del dueño (17-sep-2026): «Quiero que cada empresa tenga en
sus configuraciones una sección donde le indicamos cómo enviar
programáticamente mensajes a través del CRM. El cliente maneja una
plataforma de alquileres temporales de cabañas y comunica ciertos eventos
de la reserva; el trigger lo tiene su propio sistema y necesita un endpoint
para enviar dicho mensaje a través del CRM, teniendo en cuenta el
funcionamiento de WhatsApp y sus plantillas: un endpoint para listar las
plantillas disponibles y sus variables.» Decisiones cerradas en la
discusión del 18-sep: consentimiento declarado por el integrador; plantilla
por nombre; parámetros por índice; el agente responde solo si el contacto
pregunta o necesita algo; sin webhooks salientes ni texto libre en v1.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Crear una clave de API y leer la guía de integración (Priority: P1)

Como propietario de una empresa entro a Ajustes → API, creo una clave con
un nombre («Sistema de reservas»), la copio UNA sola vez y se la paso al
desarrollador del sistema de reservas junto con la guía que la misma
página muestra: URL base, header de autenticación, los tres endpoints y un
ejemplo `curl` ya armado por cada plantilla aprobada de mi empresa. Puedo
revocar la clave cuando quiera y ver cuándo se usó por última vez.

**Why this priority**: sin clave no hay integración; la guía en la propia
página evita soporte manual.

**Independent Test**: crear una clave por UI, copiarla, ver el prefijo en
la lista, revocarla y comprobar que deja de servir.

**Acceptance Scenarios**:

1. **Given** un propietario en Ajustes → API, **When** crea una clave con
   nombre, **Then** ve la clave completa una sola vez con botón «Copiar» y
   la lista muestra nombre, prefijo (`vk_xxxxxxxx…`), fecha de creación y
   «nunca usada».
2. **Given** una clave existente, **When** el propietario la revoca
   (confirmación), **Then** queda marcada «Revocada» y toda llamada con esa
   clave responde 401.
3. **Given** un miembro (no propietario), **When** entra a la sección,
   **Then** ve la guía y la lista pero no puede crear ni revocar.
4. **Given** una empresa con plantillas aprobadas, **When** abre la guía,
   **Then** cada plantilla aprobada tiene su `curl` de ejemplo con el nombre
   real y un placeholder por cada variable que debe proveer el integrador.
5. **Given** la sección, **When** la abre, **Then** ve el estado del canal
   (número conectado o no) y el cupo disponible de contactos iniciados.

---

### User Story 2 - Listar plantillas y enviar una notificación de reserva (Priority: P1)

Como sistema de reservas, con la clave listo las plantillas aprobadas y sus
variables (cuáles completa el CRM y cuáles debo mandar yo), y envío
«recordatorio_checkin» al huésped con sus datos. El CRM crea el contacto y
la conversación si no existen, envía la plantilla por WhatsApp y me devuelve
el id del mensaje. Si reintento la misma llamada con la misma
`Idempotency-Key`, no se envía dos veces.

**Why this priority**: es el valor de la feature.

**Independent Test**: con el wa-mock, `GET /api/v1/templates` y
`POST /api/v1/messages` → el outbox del mock tiene UN envío de plantilla con
los parámetros resueltos; la bandeja muestra la conversación con la etiqueta
«Enviado por API · Sistema de reservas».

**Acceptance Scenarios**:

1. **Given** una clave válida, **When** `GET /api/v1/templates`, **Then**
   responde solo las aprobadas, cada una con `variables[]` indicando
   `index`, `origin` y `provided_by` (`crm` | `caller`).
2. **Given** una plantilla aprobada con `{{1}}`=nombre, `{{2}}` y `{{3}}`
   de texto libre, **When** `POST /api/v1/messages` con `to`, `name`,
   `template` y `params {"2":…,"3":…}`, **Then** 201 con `message.id`,
   `contact` y `conversation`; el contacto existe con consentimiento `api`;
   el mensaje sale con los tres valores resueltos.
3. **Given** el mismo request con la misma `Idempotency-Key`, **When** se
   repite, **Then** responde el MISMO cuerpo con header
   `Idempotent-Replayed: true` y no hay segundo envío.
4. **Given** la misma `Idempotency-Key` con OTRO cuerpo, **When** se envía,
   **Then** 422 `idempotency_mismatch`.
5. **Given** un teléfono inválido, una plantilla inexistente, no aprobada,
   parámetros faltantes/sobrantes o con saltos de línea, **When** se envía,
   **Then** 422/404 con `code` específico y NO se toca WhatsApp.
6. **Given** un contacto dado de baja con la ventana cerrada, **When** se
   envía, **Then** 409 `opted_out`.
7. **Given** el cupo de 24h agotado, **When** se envía a un contacto nuevo,
   **Then** 429 `quota_exceeded` con `retryInSeconds`.
8. **Given** Meta caída, **When** se envía, **Then** 503 `meta_unavailable`,
   sin mensaje registrado, y el reintento con la misma `Idempotency-Key`
   funciona.
9. **Given** una clave revocada o inexistente, **When** se llama cualquier
   endpoint, **Then** 401 `invalid_api_key`.
10. **Given** más de 60 llamadas por minuto con una clave, **When** se
    excede, **Then** 429 `rate_limited`.

---

### User Story 3 - Consultar el estado de un mensaje (Priority: P2)

Como sistema de reservas consulto `GET /api/v1/messages/{id}` para saber si
el recordatorio se entregó, se leyó o falló y por qué, en lenguaje claro.

**Why this priority**: el 201 solo significa «aceptado por Meta»; la
entrega llega después por webhook.

**Independent Test**: enviar, consultar → `pending`; simular con el wa-mock
`delivered` y `failed` con motivo → la consulta refleja cada estado.

**Acceptance Scenarios**:

1. **Given** un mensaje enviado por API, **When** se consulta, **Then**
   responde `status` (pending/sent/delivered/read/failed), `error` amable si
   falló y `error_raw` con el texto de Meta.
2. **Given** un id de otra empresa o inexistente, **When** se consulta,
   **Then** 404.

---

### User Story 4 - El agente atiende solo si el huésped necesita algo (Priority: P2)

Como empresa, cuando el huésped responde «Gracias!» a un recordatorio
enviado por API, el agente de IA no contesta nada (sería ruido). Si responde
«¿A qué hora es el check-in?», el agente atiende normalmente.

**Why this priority**: evita que cada notificación transaccional dispare
una conversación innecesaria y consuma tokens; decisión explícita del dueño.

**Independent Test**: con el ai-mock, inbound «Gracias!» tras un envío por
API → ningún saliente del agente; inbound con pregunta → el agente responde.

**Acceptance Scenarios**:

1. **Given** el último saliente es una plantilla enviada por API, **When**
   entra un mensaje que es solo acuse de recibo/agradecimiento/confirmación,
   **Then** el agente no responde (sin llamar al proveedor).
2. **Given** el mismo contexto, **When** el mensaje pregunta o pide algo,
   **Then** el agente responde con el comportamiento normal de la empresa.
3. **Given** el último saliente NO es de API (agente, operador, campaña),
   **When** entra cualquier mensaje, **Then** el comportamiento actual no
   cambia.

---

### Edge Cases

- Plantilla con el mismo nombre en dos idiomas: `language` obligatorio
  (422 `language_required` con los idiomas disponibles).
- Plantilla legada (sin orígenes) con `{{1}}`: se expone como una variable
  `free_text` de índice 1 provista por el integrador.
- Contacto ya existente con nombre editado por el operador: `name` del
  request NO lo pisa; solo completa un nombre vacío o igual al teléfono.
- Contacto ya existente sin consentimiento: el envío por API lo registra
  (`api`) si estaba vacío; jamás pisa un `inbound`/`import`/`manual`.
- Teléfono coincidente con un contacto del Laboratorio (`is_test`): 409
  `sandbox_contact`; nada sale.
- Dos requests concurrentes con la misma `Idempotency-Key`: solo uno envía;
  el otro recibe 409 `idempotency_in_progress` y debe reintentar.
- La `Idempotency-Key` solo se persiste cuando el mensaje se creó (2xx);
  ante 4xx/5xx se libera para que el cliente reintente con la misma clave.
- Clave revocada mientras un request está en curso: el request termina; el
  siguiente recibe 401.
- El sandbox del Laboratorio es inalcanzable por API (no hay forma de
  apuntar a una conversación `is_test`).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La empresa MUST poder crear, listar y revocar claves de API
  desde Ajustes → API; crear/revocar solo con rol `owner`.
- **FR-002**: La clave MUST mostrarse completa una sola vez; en reposo solo
  se guarda su hash (SHA-256) y un prefijo visible; jamás aparece en logs.
- **FR-003**: `GET /api/v1/templates` MUST listar las plantillas aprobadas
  de la empresa con `variables[]` (`index`, `origin`, `provided_by`,
  `label`, `sample`) y un `example` de request listo para usar.
- **FR-004**: `POST /api/v1/messages` MUST aceptar `to`, `name` (opcional),
  `template` (nombre), `language` (opcional), `params` (objeto índice →
  valor) y `Idempotency-Key` (header opcional, recomendado).
- **FR-005**: El envío MUST normalizar el teléfono a wa_id (regla AR del 9),
  crear o reutilizar contacto y conversación real, registrar consentimiento
  `api` si el contacto no tenía, reservar cupo si la ventana está cerrada,
  pasar por el embudo único de plantillas y reconciliar el wa_id.
- **FR-006**: Los valores de parámetros MUST validarse antes de tocar Meta:
  no vacíos, ≤ 500 caracteres, sin saltos de línea ni tabulaciones ni más
  de 4 espacios consecutivos. La regla es compartida con campañas y envíos
  1:1.
- **FR-007**: La idempotencia MUST garantizar a lo sumo UN envío por
  (empresa, `Idempotency-Key`); una repetición devuelve la misma respuesta
  con `Idempotent-Replayed: true`; un cuerpo distinto → 422.
- **FR-008**: `GET /api/v1/messages/{id}` MUST devolver el estado del
  mensaje con motivo amable (`friendlyDeliveryError`) y crudo.
- **FR-009**: Toda llamada MUST autenticarse por `Authorization: Bearer`;
  clave inválida o revocada → 401 `invalid_api_key`; límite de 60
  llamadas/minuto por clave → 429 `rate_limited`.
- **FR-010**: Cada mensaje enviado por API MUST quedar marcado con la clave
  y la bandeja MUST mostrar «Enviado por API · <nombre de la clave>».
- **FR-011**: Cuando el último saliente de la conversación es una plantilla
  enviada por API, el agente MUST callar ante un mensaje que sea solo acuse
  de recibo/agradecimiento/confirmación, y MUST atender si el contacto
  pregunta o pide algo. En cualquier otro contexto el comportamiento del
  agente no cambia.
- **FR-012**: La sección Ajustes → API MUST mostrar estado del canal, cupo
  disponible y la guía con ejemplos `curl` generados desde las plantillas
  aprobadas reales; la referencia completa vive en `docs/api/v1.md`.
- **FR-013**: Errores con el formato `{ error: { code, message, … } }` y
  códigos estables (ver contrato).
- **FR-014**: Fuera de v1: webhooks salientes, texto libre por API, alta de
  plantillas por API, envío a conversaciones `is_test`.

### Key Entities

- **api_key**: id, `organization_id`, `name`, `key_hash` (único),
  `key_prefix`, `created_by`, `created_at`, `last_used_at`, `revoked_at`.
- **api_request**: id, `organization_id`, `api_key_id`, `idempotency_key`
  (único por empresa), `request_hash`, `status_code`, `response_body`,
  `message_id`, `created_at`.
- **message.api_key_id**: clave que originó el saliente (sin FK; la clave
  revocada conserva su fila).
- **contact.consent_source**: nuevo valor `api`.

## Success Criteria *(mandatory)*

- **SC-001**: Un desarrollador externo integra el envío en < 15 minutos con
  solo la página de Ajustes → API (clave + guía), sin soporte.
- **SC-002**: Un mismo evento reintentado con la misma `Idempotency-Key`
  produce exactamente un mensaje de WhatsApp.
- **SC-003**: Ningún error de validación llega a Meta: 422/404/409 se
  resuelven antes del embudo.
- **SC-004**: Un «Gracias!» tras una notificación por API no genera
  respuesta del agente ni llamada al proveedor LLM.
- **SC-005**: Gate técnico verde y guion `tests/e2e/014-public-api.md` en
  verde con wa-mock + ai-mock.

## Assumptions

- Constitución II intacta: la API es una superficie ENTRANTE de la
  instancia (el sistema del cliente llama al CRM); no se agrega ninguna
  dependencia externa.
- El integrador declara, al usar la clave, que los destinatarios son
  clientes de la empresa (transaccional): equivale a la «declaración de
  consentimiento» del import (Principio VIII).
- La conversación creada por API sigue las reglas actuales de IA de la
  empresa (agente encendido/apagado, KB, handoff); solo se agrega la regla
  de silencio ante acuses de recibo (FR-011).
- El país por defecto para normalizar teléfonos sin código es AR, como en
  el resto del CRM.
