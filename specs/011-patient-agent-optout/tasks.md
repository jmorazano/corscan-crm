# Tasks: Agente paciente y baja visible

**Input**: specs/011-patient-agent-optout/spec.md (plan embebido: sin
migraciones; todo sobre módulos existentes — pipeline.ts, side-effects.ts,
ingest.ts, conversations API, inbox UI).

## Phase 1: US1 — Agente paciente

- [x] T001 [US1] `executeTurn`: el turno pendiente se RE-DEBOUNCEA (espera AGENT_COALESCE_MS tras terminar el turno actual, en vez de correr inmediato) en src/server/ai/pipeline.ts
- [x] T002 [US1] Guardas de entrega conversacional en pipeline.ts: `deliverConversationalReply(conversation, text, turnInboundId)` — descarta si llegó un inbound nuevo durante la generación (y reagenda) o si el texto es idéntico al último saliente; usada en reply/move_stage.reply/update_lead.reply/handoff.farewell (las confirmaciones de turno reservado siguen con `deliverReply` plano, FR-004)
- [x] T003 [US1] Default de `AGENT_COALESCE_MS` 6000 → 20000 en src/lib/env.ts (+ guía en .env.example) y variable en Railway
- [x] T004 [P] [US1] Unit tests de las guardas (inbound nuevo → descarta+reagenda; texto idéntico → no envía; distinto → envía) en tests/unit/agent-patience.test.ts

## Phase 2: US2 — Baja visible

- [x] T005 [US2] side-effects opt-out: mover el lead del contacto a la etapa `kind='lost'` de su organización (query local, sin ciclo de imports; sin lead o sin etapa → no-op) en src/server/inbox/side-effects.ts
- [x] T006 [US2] ingest: NO disparar el agente cuando el inbound es mensaje de baja; y guard en runAgentTurn: contacto con optedOutAt → silencio, en src/server/inbox/ingest.ts + src/server/ai/pipeline.ts
- [x] T007 [US2] `ConversationDto.contact.optedOut` (serialización en /api/conversations) + badge «Dado de baja» en el header de la bandeja en src/lib/types.ts + src/app/api/conversations/route.ts + src/components/inbox/inbox-client.tsx

## Phase 3: Polish & verificación reforzada

- [x] T008 Guion E2E tests/e2e/011-patient-agent-optout.md: ráfaga de 2 mensajes → 1 sola respuesta del agente (con coalesce corto local); «Baja» → lead en Perdido + badge + agente mudo; regresión: 1 mensaje solo → responde normal
- [x] T009 Gate técnico completo + CLAUDE.md (fila del mapa)
