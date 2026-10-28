# Plan — 042 seguimiento automático del agente

Spec: [spec.md](spec.md). Sin dependencias nuevas (constitución II): ticker
in-process como los de 004/023/040, el mismo proveedor de IA y el mismo
`sendText` de WhatsApp. Migración **0031**.

## 1. Datos (migración 0031)

- `agent_profile`:
  - `follow_up_enabled boolean not null default false` (interruptor, apagado
    por defecto: ninguna empresa cambia hasta que la encienden).
  - `follow_up_timezone text not null default 'America/Argentina/Cordoba'`.
  - `follow_up_start_hour int not null default 9`, `follow_up_end_hour int
    not null default 21` (horario permitido, hora local; fin excluido).
  - `follow_up_text_1 text`, `follow_up_text_2 text` (respaldo fijo; NULL =
    el texto genérico del CRM; el de Altos lleva su enlace de Instagram).
- `contact.opted_out_source text` (`keyword` | `agent`; NULL = filas viejas =
  `keyword`). Lo necesita la decisión 2: la baja del agente no lo deja mudo.
- Tabla `agent_follow_up` (registro + reserva at-most-once):
  `id` (`fu_`), `organization_id`, `conversation_id`, `contact_id`,
  `cycle_message_id` (el último entrante del cliente que abre el ciclo),
  `step` (1|2), `status` (`reserved` | `sent` | `skipped` | `failed`),
  `reason` (motivo de omisión o error), `text`, `source` (`agent` |
  `fallback`), `message_id`, `stage_kind` (foto de la etapa al decidir),
  `scheduled_for`, `created_at`, `sent_at`, `replied_at`.
  **UNIQUE (`conversation_id`, `cycle_message_id`, `step`)**: un reinicio o
  dos réplicas nunca mandan el mismo seguimiento dos veces (AC13).
  Índice `(organization_id, created_at)` para el registro y el CSV.
- `message.details.awaitingReply?: boolean` (sin migración: `details` es
  jsonb). Ausente = «sin marca». Los seguimientos llevan
  `details.followUp = { step }`.
- `ConversationEventKind` suma `ai_follow_up` (texto en TS, sin cambio de BD).

## 2. Núcleo puro — `src/lib/follow-up.ts` (+ tests)

- `followUpDecision(input)`: recibe la foto de la conversación (último
  entrante, mensajes salientes del ciclo con sus marcas, seguimientos ya
  registrados del ciclo, equipo, etapa, baja, handoff/IA, config, `now`) y
  devuelve `{ kind: "send", step }`, `{ kind: "wait", until }`,
  `{ kind: "skip", step, reason }` o `{ kind: "done" }`. Implementa las 8
  condiciones y la tabla de tiempos de la spec. Todo con `now` inyectado.
- `allowedSlot(at, tz, startHour, endHour)` → próxima hora permitida ≥ `at`
  (reusa `zonedToUtc` de `src/lib/time.ts`).
- `matchesRefusal(text)`: lista del documento, normalizada (minúsculas, sin
  tildes) y por **palabra completa** («bastante», «¿baja el precio?» no).
- `greetingName(name)`: primer nombre si parece de persona (sin emoji,
  número, «familia», razón social…), con mayúscula inicial; si no, null.
- `fallbackText(step, name, custom)`: texto fijo con `{nombre}` o «¡Hola!».

## 3. Contrato del agente (marca y baja)

- `actions.ts`: campos opcionales `awaiting_reply?: boolean` y `opt_out?:
  boolean` en `reply`, `update_lead` y `move_stage` (laxos: `z.coerce`/
  `.catch(undefined)`; un valor raro no tumba el turno).
- `prompts.ts`: sección `SEGUIMIENTO` **solo con `follow_up_enabled`**: qué es
  «quedar esperando respuesta» (pediste fechas, pasaste precio o
  disponibilidad, hiciste una pregunta), cuándo NO (reservó, se despidió, ya
  derivaste), y `opt_out` solo ante un pedido claro de no recibir mensajes o
  «no me interesa» dicho como cierre.
- `pipeline.ts`: `deliverReply`/`deliverConversationalReply` reciben
  `details` y `sendText` los guarda en el mensaje (nuevo parámetro
  `details`). `opt_out: true` → `applyOptOut({ source: "agent" })`.
- Refactor de `side-effects.ts`: el bloque de baja pasa a
  `applyOptOut({ organizationId, contactId, at, source })` (set-si-null,
  campañas pendientes omitidas, lead a `lost`), usado por la ingesta y por el
  agente.
- Guarda de `runAgentTurn`: `opted_out` corta solo si `opted_out_source !==
  'agent'` (decisión 2). Campañas, cupo y API pública no cambian: miran
  `opted_out_at`.

## 4. Turno de seguimiento — `src/server/ai/follow-up.ts`

- `writeFollowUp(conversation, step)`: prompt corto propio (perfil del
  negocio + últimos 20 mensajes + instrucción «seguimiento N de 2, breve, sin
  repetir lo dicho, sin inventar datos ni precios nuevos») con marcador
  `[SEGUIMIENTO]` para el ai-mock. Respuesta `{action:"reply",text}` o
  `{action:"none",reason}`; extracción robusta de 001.
- Guardas sobre el texto (las mismas del turno): `privacy-guard`,
  `price-guard` (`hidePricesInReply`), `promise-guard`/`stripBookingPromise`,
  enlaces solo si están en el corpus del turno o en el texto de respaldo, tope
  de 400 caracteres, nunca igual al último saliente.
- Proveedor caído, JSON fuera de contrato o texto vacío tras las guardas →
  **texto de respaldo** (`source = 'fallback'`). `none` → `skipped` con
  `reason = 'agent_none'`.

## 5. Barrido — `src/server/follow-up/sweep.ts`

- `startFollowUpTicker()` en `instrumentation.ts`: cada 60 s, `unref`, un
  barrido a la vez (flag en `globalThis`).
- `runFollowUpSweep(now)`:
  1. Empresas con `follow_up_enabled` y agente encendido.
  2. Candidatas: conversaciones `kind='whatsapp'`, no `is_test`,
     `last_inbound_at > now − 24 h`, con último mensaje saliente IA (consulta
     acotada con `scoped()`).
  3. Por candidata arma la foto (mensajes desde el último entrante, etapa del
     lead, baja, `lastTeamMessageAt` **incluyendo difusiones**, seguimientos
     del ciclo) y llama a `followUpDecision`.
  4. `send`: **reserva** (`insert … on conflict do nothing`); si no reservó,
     sigue de largo. Escribe el texto (§4), envía con `sendText` +
     `withSendRetry` de 036 (`aiGenerated: true`, `details.followUp`), marca
     `sent` + `message_id`, línea `ai_follow_up` en el hilo. Fallo → `failed`
     con el motivo de `friendlySendError`, sin reintentar en otro barrido.
  5. `skip` definitivo (filtro, sin horario en la ventana, baja, equipo,
     `agent_none`): fila `skipped` una vez por ciclo y paso.
- Antes de enviar se re-lee el último mensaje: si entró algo del cliente
  mientras el modelo escribía, se suelta la reserva como `skipped`
  (`reason='customer_replied'`).
- `ingest.ts`/`side-effects.ts`: un entrante marca `replied_at` en los
  seguimientos `sent` de esa conversación sin respuesta.
- Ruta de pruebas `POST /api/dev/follow-up` con `now` (gate
  `dev-guard`, 404 en producción) para conducir los tiempos en E2E.

## 6. Configuración y registro (UI)

- `GET/PUT /api/agent/follow-up` (`withAuth` lectura / `withOwner`
  escritura; Zod: horas 0–23, inicio < fin, zona IANA válida, textos ≤ 500).
- `GET /api/agent/follow-up/export` → CSV del registro (`withOwner`, 90 días,
  saneo anti-fórmula de `neutralizeFormula` de 034).
- Tarjeta «Seguimiento automático» en `/agent`: interruptor, horario, zona,
  textos de respaldo con vista previa del nombre, y resumen de 7 días
  (enviados, omitidos por motivo, cuántos contestaron, respuestas **sin
  marca**) + «Descargar registro».
- Hilo: el mensaje de seguimiento lleva «Seguimiento automático 1/2» bajo la
  burbuja; las omisiones relevantes (filtro, sin horario, error) como
  `ThreadEvent` con `eventText` de `conversation-events.ts`.

## 7. Mocks

- ai-mock: rama `[SEGUIMIENTO]` → texto reconocible; perillas
  `[E2E_SEG_NADA]` (`none`), `[E2E_SEG_ROTO]` (JSON roto → respaldo),
  `[E2E_SEG_PRECIO]` (importe → respaldo). Las respuestas normales suman
  `awaiting_reply: true` por defecto; `[E2E_CIERRE]` → false,
  `[E2E_SIN_MARCA]` → sin marca, `[E2E_NO_INTERESA]` → `opt_out`.
- wa-mock: sin cambios (ya tiene `failSends`).

## Verificación

- Unit: `follow-up.test.ts` con los 12 casos del documento + AC13 (reserva)
  sobre la decisión pura; `matchesRefusal`, `greetingName`, `allowedSlot`.
- Gate: `typecheck && lint && build && test`.
- E2E `tests/e2e/042-agent-follow-up.md` (wa-mock + ai-mock + barrido con
  `now`): AC1–AC14, la tarjeta de `/agent`, el CSV y que una empresa con el
  interruptor apagado no cambia en nada.
