# Tasks: Entrenar al agente desde la Bandeja (015)

**Input**: specs/015-agent-trainer-chat/spec.md + plan.md + data-model.md + contracts/api.md

## Phase 1: Fundaciones

- [x] T001 `conversation.kind` + índice parcial, `kb_entry.source`, tabla `agent_change`, prefijo `chg_` en src/lib/db/schema.ts + src/lib/db/ids.ts + migración drizzle/0012
- [x] T002 [P] Puro: `TRAINER_CONTACT_PHONE`, `trainerVisible`, `composerMode` en src/lib/trainer.ts + tests/unit/trainer-visibility.test.ts
- [x] T003 [P] Servicios `src/server/kb/service.ts` (+ `coercePatchForKind`, `kbSize`) y `src/server/ai/profile.ts`; rutas `/api/kb*`, `/api/agent/profile`, `/api/lab/suggestions/apply` los usan (fix `kind_mismatch`) + tests/unit/kb-service.test.ts
- [x] T004 `src/server/trainer/conversation.ts` (ensure/get/sync) + exclusión del contacto sintético en `/api/contacts` + guards: `send.ts` (kind), `pipeline.ts` (trainer), DELETE conversación/contacto + test send-sandbox extendido

## Phase 2: US1 — Enseñar por texto con aplicación directa

- [x] T005 [P] [US1] `src/server/ai/trainer-actions.ts` + `src/server/ai/trainer-prompts.ts` + tests/unit/trainer-actions.test.ts + trainer-prompt.test.ts
- [x] T006 [US1] `src/server/trainer/changes.ts` (`applyTrainerChanges`, `summarizeChange`, `listChanges`) + tests/unit/trainer-changes.test.ts
- [x] T007 [US1] `src/server/ai/trainer.ts` (`postTrainerMessage`, debounce + lock + marca de cobertura, `runTrainerTurn`, error amable) + tests/unit/agent-skips-trainer.test.ts (el turno se verifica de punta a punta en el guion E2E)
- [x] T008 [US1] `GET /api/conversations` (+`trainer`, `unreadMessages`) y rama trainer en `POST /api/conversations/[id]/messages`; `PUT/DELETE /api/settings/ai` publican `conversations.updated`
- [x] T009 [US1] UI: `ConversationDto.kind`, `trainer-row.tsx` fija, header del hilo, composer modo trainer, ticks ocultos, «{nombre} está pensando…» en inbox-client/conversation-list/composer/message-thread
- [x] T010 [US1] ai-mock: rama `[ENTRENADOR]` determinista en src/server/dev/ai-mock.ts
- [x] T011 [US1] Guion tests/e2e/015-agent-trainer.md pasos 1–11 ejecutado en verde el 21-sep-2026

## Phase 3: US2 — Panel de cambios y deshacer

- [x] T012 [US2] `revertChange` + `invertChange` en changes.ts + tests
- [x] T013 [US2] Rutas `GET /api/trainer/changes`, `POST /api/trainer/changes/[id]/revert`, `POST /api/trainer/clear`
- [x] T014 [US2] `src/components/inbox/trainer-panel.tsx` (estado, modelo, tamaño, cambios con Deshacer, vaciar) + chip `source` en agent-client.tsx
- [x] T015 [US2] Guion 015-agent-trainer.md pasos 12–14 (undo, guardrails, móvil 375 px) en verde el 21-sep-2026

## Phase 4: US3 — Notas de voz

- [x] T016 [US3] Tabla `message_media` + `ai_credentials.transcription_model` + prefijo `mm_` + migración; `MessageDto.media`, `serializeMessage(m, via, media)`, LEFT JOIN en `listMessages`
- [x] T017 [US3] `transcriptionModel` end-to-end: credentials.ts (default), `/api/settings/ai`, ai-card.tsx + tests
- [x] T018 [US3] Adaptador: `ChatMessage.content` con partes, `transcribeAudio`, `ProviderHttpError` en src/lib/ai/index.ts + tests/unit/ai-transcribe.test.ts
- [x] T019 [US3] Puros: src/lib/voice-note.ts, src/lib/audio-record.ts, src/lib/http-range.ts + tests
- [x] T020 [US3] ai-mock tolera partes y devuelve `MOCK_TRANSCRIPTION` ante `input_audio` + test
- [x] T021 [US3] `GET /api/message-media/[id]` autenticado con Range
- [x] T022 [US3] `src/server/trainer/voice.ts` + `POST /api/conversations/[id]/messages/audio` + evento SSE `message.updated` (validación en tests/unit/voice-note.test.ts; la ruta se verifica en el guion E2E: 415/413/409/201)
- [x] T023 [US3] Burbuja de audio en message-thread.tsx (reproductor, estados de transcripción)
- [x] T024 [US3] Composer: input de archivo oculto + clip + drag&drop + `sendVoiceNote` en inbox-client.tsx
- [x] T025 [US3] `use-voice-recorder.ts` (MediaRecorder) + botón mic + barra de grabación
- [x] T026 [US3] Fallback WAV: public/pcm-recorder-worklet.js + `encodeWav` (unit; el camino real queda pendiente de verificación humana)
- [x] T027 [US3] Fixture tests/e2e/fixtures/nota-de-voz.wav (+ generador) y guion tests/e2e/015-trainer-audio.md en verde el 21-sep-2026 (grabación real con micrófono: pendiente de verificación humana)

## Phase 5: Docs, verificación y cierre

- [x] T028 CLAUDE.md (fila del mapa + feature activa) + spec-kit al día
- [x] T029 Gate técnico completo (typecheck + lint + build + test, 570 unit) + E2E en verde + memoria
