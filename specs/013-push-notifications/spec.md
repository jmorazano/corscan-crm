# Feature Specification: Notificaciones push en el celular

**Feature Branch**: `013-push-notifications`

**Created**: 2026-09-17

**Status**: Draft

**Input**: Pedido del dueño (17-sep-2026), a continuación del CRM móvil (012):
«luego implementamos las push». El operador atiende desde el teléfono y hoy
solo se entera de un mensaje nuevo si tiene la app abierta (SSE). Necesita
que el teléfono le avise como WhatsApp: una notificación por cada mensaje
entrante (o solo cuando un cliente pide un humano), que al tocarla abra esa
conversación.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Activar avisos en este dispositivo (Priority: P1)

Como operador, entro a Ajustes → Notificaciones desde el celular (con la app
instalada en la pantalla de inicio, que en iPhone es requisito), toco
«Activar en este dispositivo», acepto el permiso del sistema y desde ese
momento el teléfono me avisa. Elijo si quiero TODOS los mensajes entrantes o
SOLO cuando un cliente necesita atención humana (la IA se pausó o escaló).
Puedo enviarme una prueba y desactivar cuando quiera.

**Why this priority**: sin suscripción no hay avisos; es la puerta de
entrada de toda la feature.

**Independent Test**: en un navegador con soporte, activar, recibir la
prueba, cambiar el modo, desactivar; en iPhone sin instalar, ver la guía de
instalación en vez del botón.

**Acceptance Scenarios**:

1. **Given** un navegador con Web Push, **When** toco «Activar en este
   dispositivo» y acepto el permiso, **Then** la página muestra «Activas en
   este dispositivo», el modo elegido y el dispositivo cuenta en la lista.
2. **Given** iPhone en Safari sin instalar, **When** abro la página,
   **Then** veo la guía «Compartir → Agregar a inicio» y el botón no está.
3. **Given** permiso bloqueado, **When** intento activar, **Then** se explica
   cómo desbloquearlo en el navegador; nada se cuelga.
4. **Given** avisos activos, **When** toco «Enviar prueba», **Then** llega una
   notificación de prueba a este dispositivo en segundos.
5. **Given** avisos activos, **When** toco «Desactivar», **Then** el
   dispositivo deja de recibir y desaparece de la lista.

---

### User Story 2 - Aviso de mensaje entrante que abre la conversación (Priority: P1)

Como operador con avisos activos, cuando un cliente escribe recibo una
notificación con su nombre y el texto (o «📎 Imagen», etc.); varios mensajes
del mismo chat reemplazan la anterior (no se apilan). Tocarla abre el CRM en
esa conversación. Si elegí «solo atención humana», recibo el aviso cuando la
conversación está en manos humanas (IA en pausa o escalada) y cuando la IA
escala una conversación.

**Why this priority**: es el valor de la feature: enterarse sin tener la app
abierta.

**Independent Test**: con el wa-mock inyectar un entrante y comprobar que el
servidor envía el push (endpoint mock) con el payload correcto; en modo
«handoff» no se envía para una conversación atendida por la IA, y sí al
escalar.

**Acceptance Scenarios**:

1. **Given** una suscripción en modo «todos», **When** entra un mensaje,
   **Then** se envía un push con título = nombre del contacto, cuerpo = texto
   truncado a 120 caracteres, `tag` = id de conversación y URL
   `/inbox?c=<id>`.
2. **Given** modo «solo atención humana» y una conversación con IA activa,
   **When** entra un mensaje, **Then** NO se envía; **When** la IA escala
   (handoff), **Then** se envía «Atención humana: <contacto>» con el motivo.
3. **Given** una notificación en pantalla, **When** la toco, **Then** se
   enfoca la app (o se abre) en `/inbox?c=<id>`.
4. **Given** una conversación de sandbox (`is_test`), **When** hay
   actividad, **Then** jamás se notifica.
5. **Given** un endpoint que responde 404/410, **When** se intenta enviar,
   **Then** la suscripción se elimina sola; cualquier otro fallo del push se
   registra y NUNCA afecta la ingesta del mensaje.

---

### Edge Cases

- El navegador cambia el endpoint (`pushsubscriptionchange`): el service
  worker se re-suscribe con la misma clave y la registra; si no puede, el
  próximo inicio de la app re-sincroniza.
- Un usuario con varias empresas: cada suscripción se liga a la empresa
  activa al activarla; volver a activar en otra empresa la re-liga.
- Sin clave VAPID todavía: se genera sola al primer uso, por empresa, y la
  privada se guarda cifrada. Nada que configurar en el instalador.
- Permiso concedido pero sin suscripción en el servidor (BD nueva, borrado):
  al abrir la app con permiso concedido se re-registra en silencio.
- Notificaciones bloqueadas a nivel de sistema (iOS «Notificaciones»
  apagadas para la app): el permiso web dice «granted» pero no llegan; la
  guía lo menciona.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La app MUST servir un service worker en `/sw.js` que solo
  maneje `push`, `notificationclick` y `pushsubscriptionchange` (sin caché
  ni modo offline).
- **FR-002**: La app MUST generar y guardar claves VAPID POR EMPRESA al
  primer uso, con la privada cifrada en reposo (AES-256-GCM); la pública se
  expone por `GET /api/push/vapid` solo a usuarios autenticados.
- **FR-003**: MUST existir `POST/PATCH/DELETE /api/push/subscriptions`
  (alta idempotente por endpoint, modo, baja) y `GET` para listar los
  dispositivos del usuario; toda fila lleva `organization_id` y `user_id`.
- **FR-004**: MUST existir `POST /api/push/test` que envía una prueba a los
  dispositivos del usuario y devuelve el resultado por endpoint.
- **FR-005**: Al ingerir un mensaje entrante el servidor MUST enviar push a
  las suscripciones de la empresa según su modo (`all` siempre; `handoff`
  solo si la conversación tiene `handoff_at` o IA apagada), en segundo plano
  y sin bloquear ni fallar la ingesta.
- **FR-006**: Al aplicar un handoff el servidor MUST enviar push a todas las
  suscripciones de la empresa (ambos modos).
- **FR-007**: El payload MUST incluir título, cuerpo (≤ 120 caracteres),
  `tag` por conversación, URL de destino e ícono de la marca.
- **FR-008**: Un push respondido con 404/410 MUST eliminar la suscripción.
- **FR-009**: Ajustes → Notificaciones MUST mostrar soporte, permiso, estado
  del dispositivo, modo, dispositivos activos, prueba y desactivar; en iOS
  sin instalar MUST mostrar la guía de instalación.
- **FR-010**: La app MUST re-sincronizar en silencio la suscripción existente
  al iniciar con permiso concedido, y MUST reflejar los no leídos en el
  badge del ícono (Badging API) cuando el navegador lo soporte.
- **FR-011**: El modo de pruebas MUST ofrecer un endpoint push simulado
  (`/api/dev/push-mock`, 404 en producción) que registre entregas y pueda
  responder 410 para verificar la poda.
- **FR-012**: Las conversaciones `is_test` MUST quedar fuera de toda
  notificación.

### Key Entities

- **push_vapid_key**: `organization_id` (PK), `public_key`, `private_key`
  cifrada, `created_at`.
- **push_subscription**: id, `organization_id`, `user_id`, `endpoint`
  (único), `p256dh`, `auth`, `mode` (`all` | `handoff`), `user_agent`,
  `created_at`, `last_used_at`.

## Success Criteria *(mandatory)*

- **SC-001**: Activar, probar y desactivar desde Ajustes toma < 30 s y no
  requiere ninguna configuración del operador ni del instalador.
- **SC-002**: Un entrante produce exactamente un push por dispositivo
  suscripto (modo `all`) en < 3 s desde la ingesta.
- **SC-003**: Un endpoint muerto (410) desaparece de la tabla en el primer
  intento; la ingesta del mensaje termina igual.
- **SC-004**: Gate técnico verde y guion `tests/e2e/013-push.md` en verde con
  el push-mock.

## Assumptions

- **Constitución (II)**: Web Push es un protocolo estándar (RFC 8030/8291/
  8292): el servidor habla con el push service que ELIGE EL NAVEGADOR DEL
  USUARIO, con claves VAPID propias, sin cuenta ni contrato con terceros y
  sin costo. Se incorpora como cuarta categoría permitida (v1.6.0); el
  producto funciona completo sin activarla.
- iOS requiere 16.4+ y la app instalada en la pantalla de inicio; Android/
  Chrome y escritorio funcionan desde el navegador.
- La librería `web-push` se usa para firmar VAPID y cifrar el payload; el
  envío HTTP lo hace `fetch` propio (permite el mock local y timeouts).
- Sin preferencias por horario ni silenciar por conversación en esta
  versión.
