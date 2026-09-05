# Contrato — Campañas y conversación saliente

Todos con `withAuth`. Formato de error estándar.

## POST /api/conversations (NUEVO — US2)

Inicia una conversación con plantilla hacia un contacto sin conversación
(o reutiliza la existente — idempotente).

Body: `{ contactId, templateId, variable?: string }`.
Guards en orden → error:
- contacto no existe en la org → 404
- contacto dado de baja → 409 `opted_out`
- plantilla no aprobada → 422 `template_not_approved`
- {{1}} requerida y ausente (modo manual: si la plantilla tiene variable,
  `variable` es obligatoria) → 422
- sin credenciales / reconnect → 409 `not_connected` / `reconnect_required`
- cupo de 24h agotado → 429 `quota_exceeded` (con `retryInSeconds` estimado)
- sandbox: contacto/conversación de prueba → 403 `sandbox_violation`

Efecto: getOrCreateContact/getOrCreateConversation (reuso de ingest) +
sendTemplate; registra `initiated_send` post-éxito; reconcilia
`contacts[0].wa_id` (D3). Respuesta 201 `{ conversationId, messageId }`.

## GET /api/campaigns · POST /api/campaigns

GET: lista con `{ id, name, status, pausedReason, templateName, tagFilter,
counts, launchedAt }` (counts agregados con delivered/read derivados del
JOIN con message).
POST body: `{ name(1..120), templateId, tagFilter: string[], variableMode:
'contact_name'|'fixed', variableText? }` → crea `draft`. Valida plantilla
existente y con ≤1 variable; si `fixed` con variable, `variableText`
obligatoria. 201 `{ id }`.

## GET /api/campaigns/segment-preview?tags=a,b

`{ eligible: number }` — tamaño del segmento elegible HOY (FR-013).

## GET /api/campaigns/[id]

Detalle + counts + página de destinatarios
`{ recipients: [{ contactId, name, phone, status, deliveryStatus?, repliedAt,
skipReason, error }], nextCursor? }`.

## POST /api/campaigns/[id]/actions

Body `{ action: 'launch' | 'pause' | 'resume' | 'cancel' }`.
- `launch` (solo `draft`): re-valida plantilla `approved`, congela
  destinatarios elegibles (data-model), 422 `segment_empty` si 0; pasa a
  `running` y dispara el runner fire-and-forget (202).
- `pause` (solo `running`): cooperativa — el envío en vuelo termina, no se
  dispara otro. `resume` (solo `paused`): re-dispara el runner.
- `cancel` (`running|paused`): pendientes → `skipped(cancelled)`, terminal.
- Transición inválida → 409 `invalid_transition`.

## Runner (comportamiento, no HTTP)

Secuencial por campaña con pacing `CAMPAIGN_PACE_MS` (default 4000ms +
jitter; env de instancia, el E2E lo baja). Antes de cada envío, bajo el
mutex de cupo por org: elegibilidad re-verificada (opt-out sobrevenido →
`skipped`), cupo 24h (contactos únicos) → si agotado, campaña
`paused(daily_limit)` y el ticker la reanuda al liberarse cupo. Fila:
`pending→sending` → Graph → persistir `wa_message_id` → `sent` + registrar
`initiated_send` + SSE. Fallos: transitorio (throughput/5xx) 1 reintento con
backoff; permanentes → `failed(error)`; `reconnect_required`/`not_connected`
→ campaña `paused(channel)`. Revive al boot (instrumentation): campañas
`running` se re-disparan; `sending` con wamid = sent, sin wamid =
re-intentable. Completa cuando no quedan `pending`.

## SSE

`campaign.progress` (bus org:{id}) con counts agregados; el cliente hace
catch-up por refetch de GET /api/campaigns/[id].

## Guardrail de cupo compartido

El sender de plantillas EXISTENTE (conversación con ventana cerrada) también
registra `initiated_send` y respeta el cupo (429 `quota_exceeded`), para que
el contador refleje la realidad del canal (FR-015).
