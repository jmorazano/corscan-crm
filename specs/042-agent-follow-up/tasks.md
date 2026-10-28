# Tasks — 042 seguimiento automático del agente

## Fase A — Datos y núcleo puro
- [x] A1 `schema.ts` + migración 0031: columnas `follow_up_*` en
  `agent_profile`, `contact.opted_out_source`, tabla `agent_follow_up` con
  UNIQUE (`conversation_id`, `cycle_message_id`, `step`).
- [x] A2 `MessageDetails.awaitingReply` / `followUp`; `ConversationEventKind`
  `ai_follow_up` + textos en `conversation-events.ts`.
- [x] A3 `src/lib/follow-up.ts`: `followUpDecision`, `allowedSlot`,
  `matchesRefusal`, `greetingName`, `fallbackText` + tests con los 12 casos
  del documento.

## Fase B — Agente (marca y baja)
- [x] B1 `actions.ts`: `awaiting_reply` y `opt_out` laxos en `reply`,
  `update_lead`, `move_stage` + tests del contrato.
- [x] B2 `sendText` acepta `details`; `deliverReply`/`deliverConversationalReply`
  guardan la marca.
- [x] B3 `applyOptOut({ source })` extraído de `side-effects.ts`; el agente lo
  llama con `source: 'agent'`.
- [x] B4 `runAgentTurn`: la baja del agente no lo deja mudo (`keyword` sí).
- [x] B5 `prompts.ts`: sección `SEGUIMIENTO` solo con el interruptor encendido.

## Fase C — Seguimientos
- [x] C1 `src/server/ai/follow-up.ts`: turno propio + guardas + respaldo fijo.
- [x] C2 `src/server/follow-up/sweep.ts`: candidatas, foto, decisión, reserva,
  envío con `withSendRetry`, registro, re-lectura antes de enviar.
- [x] C3 Equipo en el ciclo (difusiones incluidas) dentro de `followUpDecision` (sin tocar `lastTeamMessageAt`).
- [x] C4 `replied_at` desde la ingesta.
- [x] C5 `startFollowUpTicker()` en `instrumentation.ts`.
- [x] C6 `POST /api/dev/follow-up` (dev-guard, `now` inyectable) para E2E.

## Fase D — Configuración, registro y UI
- [x] D1 `GET/PUT /api/agent/follow-up` (owner escribe) + Zod.
- [x] D2 `GET /api/agent/follow-up/export` (CSV saneado).
- [x] D3 Tarjeta «Seguimiento automático» en `/agent` con resumen de 7 días.
- [x] D4 Hilo: etiqueta «Seguimiento automático N/2» y líneas de omisión/error.

## Fase E — Mocks y verificación
- [x] E1 ai-mock: rama `[SEGUIMIENTO]`, perillas `none`/JSON roto, marcas
  `[E2E_CIERRE]`/`[E2E_SIN_MARCA]`/`[E2E_NO_INTERESA]` (por defecto espera).
- [x] E2 Gate: typecheck + lint + test + build.
- [x] E3 Guion `tests/e2e/042-agent-follow-up.md` conducido (AC1–AC14, CSV,
  interruptor apagado sin cambios).
- [x] E4 CLAUDE.md (mapa + feature activa) y memoria.

## Estado
Implementado y verificado (28-oct-2026): gate verde (typecheck, lint, 2033
tests, build) y E2E 40/40 (`tests/e2e/042-agent-follow-up.md`). C3 no hizo
falta como cambio: la decisión pura mira directamente los salientes del
equipo del ciclo, difusiones incluidas. Sin deploy ni merge.
