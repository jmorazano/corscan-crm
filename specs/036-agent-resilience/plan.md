# Plan — 036

Sin migración (la próxima sigue siendo la 0028). Sin dependencias nuevas.

## 1. Reintento del envío

- `src/lib/meta/client.ts` · `graphRequest`: `AbortSignal.timeout` (20 s;
  120 s con `form`), también sobre la lectura del cuerpo. Timeout/red →
  `MetaApiError` status 0 (→ `meta_unavailable` en `callGraphSend`).
- `src/lib/send-retry.ts` (PURO): `SEND_RETRY_DELAYS_MS = [2000, 5000]`,
  `isRetryableSendCode`, `withSendRetry(fn, { delays, sleep, onRetry })`.
- `deliverReply` (`pipeline.ts`) envuelve `sendText` con `withSendRetry`.

## 2. Retomar al vencer la ventana

- `src/lib/agent-presence.ts` (PURO): `pendingAfterTeam({ lastTeamAt,
  windowMs, lastInboundAt })` → el último entrante llegó durante la ventana.
- `pipeline.ts`:
  - `scheduleResumeCheck(conversationId, until)`: un timer por conversación
    (mapa global propio) que al vencer llama a `scheduleAgentTurn(id, 0)` si
    no hay turno en curso/pendiente.
  - En `runAgentTurn`, silencio `team_active` con `until` → programa la
    retoma.
  - Turno de retoma (`pendingAfterTeam`): (a) si todo lo que escribió el
    cliente desde la última respuesta es acuse (`isPlainAcknowledgment`) →
    `silence("no_reply_needed", detalle)` sin llamar al modelo; (b) ventana
    de 24 h cerrada → callar sin handoff; (c) si no, sección del prompt
    `RETOMA TRAS EL EQUIPO` (responder solo si quedó esperando; si no,
    `none` con motivo; sin presentarse; disculpa breve por la demora).
- Arranque (`instrumentation.ts`): `rescheduleTeamResumes()` — último evento
  de la conversación = `ai_silent/team_active` de las últimas 24 h →
  `scheduleResumeCheck(max(until, ahora + 5 s))`.
- Texto del hilo (`conversation-events.ts`): «A las HH:MM retoma sola si el
  cliente quedó esperando respuesta».

## 3. Difusiones del equipo

- `agent-presence.ts` (PURO): `BROADCAST_MIN_CONVERSATIONS = 3`,
  `BROADCAST_SPAN_MS = 30 min`, `PROACTIVE_GAP_MS = 60 min`,
  `isBroadcast({ text, customerWroteBefore, sameTextConversations })`.
- `src/server/ai/events.ts` · `lastTeamMessageAt` → recorre los últimos 10
  mensajes del equipo y saltea las difusiones (2 consultas por candidato:
  entrante en la hora previa y conversaciones con el mismo texto ±30 min).
  Marca `details.broadcast = true` en los detectados y publica
  `message.updated` (el panel deja de contarlos).
- `details.broadcast` viaja en el `MessageDto`; `inbox-client` no la cuenta en `lastTeamAt`.
- `teamIntervened` del prompt sigue usando `isTeamMessage` (la difusión es
  del equipo).

## 4. Mocks

- wa-mock knob `failSends: number` (los próximos N envíos fallan con 500).

## Verificación

Unit (puros + pipeline con stubs) · gate · E2E `tests/e2e/036-agent-resilience.md`
con wa-mock + ai-mock y la ventana del equipo en 1 min.
