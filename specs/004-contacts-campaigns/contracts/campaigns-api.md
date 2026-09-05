# Contrato — Campañas y conversación saliente

Todos con `withAuth`. Formato de error estándar.

## POST /api/conversations (NUEVO — US2)

Inicia una conversación con plantilla hacia un contacto sin conversación
(o reutiliza la existente — idempotente a nivel conversación Y mensaje).

Body: `{ contactId, templateId, variable?: string }`.
Guards en orden → error:
- contacto no existe en la org → 404
- contacto de prueba (`contact.is_test`) → 403 `sandbox_violation`
- contacto dado de baja → 409 `opted_out`
- plantilla no aprobada → 422 `template_not_approved`
- {{1}} requerida y ausente → 422
- sin credenciales / reconnect → 409 `not_connected` / `reconnect_required`
- **dedup de reintento (FR-009)**: si la conversación ya tiene un saliente
  de la MISMA plantilla en las últimas 24h → 200 con el
  `{ conversationId, messageId }` existente, SIN re-enviar
- cupo: solo si la ventana de servicio está cerrada (o no hay conversación)
  — reserva bajo el mutex de cupo; agotado → 429 `quota_exceeded` (con
  `retryInSeconds` estimado); exento si ESE contacto ya fue iniciado en la
  ventana (FR-015)

Efecto: getOrCreateContact/getOrCreateConversation (reuso de ingest) +
sendTemplateCore (reserva de initiated_send ANTES de Graph, compensada si
falla) + reconciliación `contacts[0].wa_id` con el guard anti-eco de
research D3 (si colisiona con otro contacto: el envío queda hecho y se
responde con aviso `wa_id_conflict`). Respuesta 201 `{ conversationId,
messageId }` (200 en el caso dedup). Si Graph falla tras crear la
conversación, puede quedar una conversación vacía transitoria en bandeja —
aceptado; el reintento la reutiliza.

## GET /api/campaigns · POST /api/campaigns

GET: lista con `{ id, name, status, pausedReason, templateName, tagFilter,
counts, launchedAt }`. En counts, `delivered`/`read` derivan del JOIN con
message y `failed` FUSIONA fallo de envío (recipient.status='failed') y
fallo de entrega asíncrono (message.status='failed').
POST body: `{ name(1..120), templateId, tagFilter: string[], variableMode:
'contact_name'|'fixed', variableText? }` → crea `draft`. Valida plantilla
existente y con ≤1 variable; si `fixed` con variable, `variableText`
obligatoria. 201 `{ id }`.

## GET /api/campaigns/segment-preview?tags=a,b

`{ eligible: number }` — tamaño del segmento elegible HOY (FR-013),
con el predicado completo de elegibilidad del data-model (is_test incluido).

## GET /api/campaigns/[id]

Detalle + counts + página de destinatarios
`{ recipients: [{ contactId, name, phone, status, deliveryStatus?, error?,
repliedAt, skipReason }], nextCursor? }` — `deliveryStatus`/`error` de
entrega salen del JOIN con message.

## POST /api/campaigns/[id]/actions

Body `{ action: 'launch' | 'pause' | 'resume' | 'cancel' }`.
- `launch` (solo `draft`): re-valida plantilla `approved`, congela
  destinatarios elegibles (data-model), 422 `segment_empty` si 0; pasa a
  `running` y dispara el runner fire-and-forget (202).
- `pause`: sobre `running` → paused(manual). TAMBIÉN sobre
  `paused(daily_limit|channel|error)` → reescribe el motivo a `manual`
  (la pausa manual gana; el ticker no la toca). Incrementa
  `runner_generation`.
- `resume` (solo `paused`): incrementa `runner_generation` y re-dispara el
  runner.
- `cancel` (`running|paused`): pendientes → `skipped(cancelled)`, terminal.
- Transición inválida → 409 `invalid_transition`.

## Runner (comportamiento, no HTTP)

Al ARRANCAR cualquier corrida (launch, resume, ticker, revive): primero
resuelve filas `sending` residuales — CON wamid → `sent` (+reponer
initiated_send faltante, idempotente); SIN wamid → `failed("interrumpido
por reinicio")`, jamás re-envío automático (at-most-once, FR-018). Captura
`runner_generation`; antes de cada fila re-lee status y generación: si la
campaña ya no está `running` o la generación cambió, se auto-termina en
silencio.

Por fila: claim atómico `pending→sending` (UPDATE guardado; 0 filas
afectadas = otra corrida la tiene, saltar) → re-verificar elegibilidad
(opt-out sobrevenido → `skipped`) → bajo el mutex FIFO de cupo por org:
ventana del destinatario cerrada ⇒ verificar cupo (con exención por
contacto ya iniciado) y RESERVAR initiated_send → sendTemplateCore →
persistir `wa_message_id` → `sent` → SSE. Pacing `CAMPAIGN_PACE_MS`
(envSchema; default 4000ms + jitter) entre filas.

Fallos: transitorio (throughput/5xx) 1 reintento con backoff (la reserva se
mantiene); permanente → `failed(error)` + DELETE de la reserva; 3 fallos
consecutivos con el mismo código (clase plantilla/canal) → circuit breaker:
campaña `paused(channel)` con motivo visible; `reconnect_required` /
`not_connected` → `paused(channel)`. Cupo agotado → `paused(daily_limit)`;
el ticker reanuda SOLO `daily_limit`. Excepción no manejada del runner →
`.catch` marca `running→paused('error')` + SSE (nada de campañas zombie).
Completa cuando no quedan `pending` ni `sending`.

## SSE

`campaign.progress` (bus org:{id}) con counts agregados; el cliente hace
catch-up por refetch de GET /api/campaigns/[id].

## Guardrails compartidos en el sender EXISTENTE

El sender de plantillas en conversación (ventana cerrada) también: (1)
respeta el opt-out → 409 `opted_out` (FR-010; dentro de ventana responder
sigue permitido, FR-012); (2) pasa por el mismo mutex de cupo con reserva
cuando la ventana está cerrada → 429 `quota_exceeded` (FR-015).
