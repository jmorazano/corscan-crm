# Plan — 031 agente a la vista

## Datos (migración 0025)

- `conversation_event` (`ev_`): `organization_id` NOT NULL (cascade),
  `conversation_id` (cascade), `kind` (`ai_toggled|ai_silent|ai_resumed|
  ai_handoff|ai_error`), `reason` text, `actor_user_id` (FK user, set null),
  `actor_name` (copia), `details` jsonb, `created_at`. Índice
  `(organization_id, conversation_id, created_at)`.
- `message.sent_by_user_id` (FK user, set null).
- `agent_profile.team_silence_ms` (NULL = 10 min).

## Código

- `src/lib/agent-presence.ts` (PURO): `isTeamMessage`, `resolveTeamSilenceMs`
  + conversión min↔ms, `agentPresence({aiEnabled, handoffAt, lastTeamAt,
  now, windowMs})` → `{silent, reason, until|null}` | `{silent:false,
  resumed}`; `presenceHint` para el panel.
- `src/lib/linkify.ts` (PURO) + `Linkified` en `message-thread.tsx`.
- `src/lib/conversation-events.ts` (PURO): tipos del DTO, textos de cada
  evento (`eventText`), `friendlyProviderError`, `friendlyToolFailure`,
  `friendlySendError`, `shouldSkipSilence` (dedup).
- `src/lib/lookup-promise.ts` (PURO): `announcesLookup(text)`.
- `src/server/ai/events.ts`: `recordConversationEvent` (scoped, no lanza,
  publica SSE `conversation.event`), `listConversationEvents`,
  `lastTeamMessageAt`.
- `chatJson`: `status` en el resultado fallido (último HTTP del proveedor).
- MCP: `RenderResult.failure` en transporte/guardrails/catch.
- Pipeline: chequeo de presencia (reemplaza el corte de handoff/aiEnabled),
  reactivación, eventos en cada salida silenciosa, `applyHandoff` con
  detalle, `lead_note` en herramientas, guarda de promesas con un reintento,
  nota de intervención del equipo en el prompt, envío fallido → evento.
- Envíos del CRM con autor: `sendText`, `sendMedia`, `sendTemplateCore`,
  `sendInstagramConversationText` reciben `sentByUserId`; rutas
  `/messages`, `/messages/media`, `/messages/template`, `POST
  /api/conversations`.
- PATCH conversación: evento con actor (nombre del usuario).
- GET `/api/conversations/[id]/messages` → `events` (mismo `since`).
- UI: `MessageThread` intercala `ThreadEvent`; `inbox-client` guarda eventos
  y escucha `conversation.event`; `ContactPanel` muestra qué falta para que
  vuelva; `MessageDto.team`; tarjeta de la ventana en `/agent`.
- Prompt: regla anti-promesa (con herramientas), `lead_note`, `none.reason`,
  comprobantes, sección de intervención del equipo.
- ai-mock: ramas para probar promesa vacía, `none` con motivo y error 402.

## Verificación

Unit (presencia, textos, promesa, dedup) + guion E2E
`tests/e2e/031-agent-presence.md` con wa-mock + ai-mock en el worktree
(BD `vocero_031`), feliz e infeliz, escritorio y móvil; gate completo.
