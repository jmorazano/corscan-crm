# Implementation Plan: Entrenar al agente desde la Bandeja (015)

**Branch**: `015-agent-trainer-chat` | **Date**: 2026-09-21 | **Spec**: [spec.md](spec.md)

## Summary

Conversación fija por empresa con su propio agente (`conversation.kind =
'trainer'`, contacto sintético `is_test`), turno propio inmediato con
contrato de acciones separado (`reply` | `apply{changes}`), capa de
servicio compartida de knowledge base y perfil, auditoría `agent_change`
con «Deshacer», panel derecho específico, y (P3) notas de voz grabadas en
el navegador, guardadas en Postgres y transcritas por el mismo proveedor
OpenRouter con un modelo multimodal.

## Technical Context

**Language/Version**: TypeScript estricto, Next.js 15 App Router, React 19
**Primary Dependencies**: Drizzle ORM, Zod, adaptador OpenRouter propio
(`src/lib/ai`), MediaRecorder/AudioWorklet del navegador — sin dependencias
npm nuevas
**Storage**: PostgreSQL — `conversation.kind`, `kb_entry.source`, tablas
`agent_change` y `message_media`, `ai_credentials.transcription_model`
**Testing**: Vitest (unit, `tests/unit/`) + guiones E2E
`tests/e2e/015-agent-trainer.md` y `tests/e2e/015-trainer-audio.md` con
wa-mock/ai-mock conducidos desde el Browser pane
**Constraints**: multi-tenant (`scoped()`), sandbox inalcanzable (doble
guardrail), sin colas (lock in-process), audio ≤ 8 MB / 3 min, sin webm
**Scale/Scope**: una conversación por empresa, decenas de mensajes/día

## Constitution Check

- **I Seguridad**: el audio se sirve solo autenticado y por tenant; el
  detalle de errores del proveedor va redactado al log, nunca al cliente. ✅
- **II Soberanía**: ninguna dependencia externa nueva; la transcripción va
  por el adaptador OpenRouter existente (categoría 2). Sin bump. ✅
- **III Multi-tenancy**: `organization_id` NOT NULL en `agent_change` y
  `message_media`; toda query por `scoped()`. ✅
- **IV Idempotencia**: creación perezosa con índices parciales únicos +
  `onConflictDoNothing`; undo idempotente (409 si ya revertido). ✅
- **V/IX Verificación**: unit de lo puro + E2E con mocks (feliz + infeliz,
  escritorio + 375 px); la grabación real queda «pendiente de verificación
  humana». ✅
- **VIII Foco**: el entrenador mejora cómo se atienden conversaciones de
  WhatsApp. ✅

## Decisiones de diseño (research)

- **D1 Identidad**: `kind` enum `whatsapp|trainer` + `is_test=true` en la
  conversación y en el contacto sintético → los guards existentes (sender,
  plantillas, push, facets, board, paginación) la excluyen sin tocarlos;
  índice parcial único `(organization_id) WHERE kind='trainer'`.
- **D2 Contacto sintético**: `phone='trainer'` (no numérico a propósito:
  `normalizeToWaId` lo rechaza → import, contactos, API pública e ingesta
  no pueden crearlo ni alcanzarlo); nombre = nombre del agente, archivado.
- **D3 Lista**: fuera del keyset (`ConversationPage.trainer`), resuelto en
  `GET /api/conversations` sin cursor; visible solo sin búsqueda/etiquetas y
  en «No leídas» solo con pendientes; el badge de la pestaña lo suma.
- **D4 Dirección**: dueño → `out` (derecha, sin ticks); agente → `in` +
  `ai_generated` (izquierda, chip IA, suma no leídos). Al modelo:
  `out→user`, `in→assistant` (inverso al pipeline de clientes).
- **D5 Turno**: módulo propio `src/server/ai/trainer.ts`, inmediato, con
  lock `running/pending` por conversación (mismo patrón `globalThis` del
  pipeline, sin timer); UNA llamada `chatJson`; el servidor aplica después;
  fallo del proveedor → respuesta amable, nunca handoff.
- **D6 Acciones**: `TrainerAction` separado de `AgentAction` (jamás
  expuesto a clientes): `reply{text}` | `apply{changes[≤10], reply}`;
  cambios `kb_add|kb_update|kb_delete|profile_set|profile_append`.
- **D7 Auditoría/undo**: `agent_change` con `before/after` jsonb y resumen
  generado en el servidor; undo restaura `before` en transacción, no crea
  fila, deja «Deshice: …» en el hilo; `kb_entry.source` para el chip.
- **D8 Servicio KB/perfil**: `src/server/kb/service.ts` y
  `src/server/ai/profile.ts` reemplazan el Drizzle inline de las rutas y
  cierran el bug de coherencia `kind`↔campos del `PATCH /api/kb/[id]`.
- **D9 Audio**: OpenRouter acepta `input_audio` base64 en formatos wav,
  mp3, aiff, aac, ogg, flac, m4a (docs 21-sep-2026), no webm/mp4 → el
  grabador negocia `audio/mp4` (→ `m4a`) / `audio/ogg` y cae a WAV PCM puro
  en JS; blob en `message_media` (privado, con `Range` para iOS);
  transcripción en texto plano con `transcribeAudio` (2 intentos, sentinel
  `[SIN_CONTENIDO]`), y la transcripción entra al turno como texto.
- **D10 «Pensando…»**: estado del cliente (POST ok → hasta `message.new`
  entrante o 90 s); sin evento SSE nuevo. US3 agrega `message.updated`.

## Project Structure

```text
src/lib/trainer.ts                          # puro: TRAINER_CONTACT_PHONE, trainerVisible, composerMode
src/lib/voice-note.ts                       # puro (US3): sniff/normalize mime, validateVoiceNote
src/lib/audio-record.ts                     # puro (US3): mime del grabador, encodeWav, formatElapsed
src/lib/http-range.ts                       # puro (US3): parseByteRange
src/lib/ai/index.ts                         # content parts + transcribeAudio (US3)
src/lib/db/schema.ts · ids.ts · drizzle/    # kind, source, agent_change, message_media, transcription_model
src/server/kb/service.ts                    # servicio KB compartido
src/server/ai/profile.ts                    # servicio de perfil
src/server/ai/trainer-actions.ts            # TrainerAction/TrainerChange (Zod)
src/server/ai/trainer-prompts.ts            # TRAINER_MARKER, renderKbWithIds, buildTrainerSystemPrompt
src/server/ai/trainer.ts                    # postTrainerMessage, scheduleTrainerTurn, runTrainerTurn
src/server/trainer/conversation.ts          # ensureTrainerConversation, getTrainerConversation
src/server/trainer/changes.ts               # applyTrainerChanges, summarizeChange, revertChange
src/server/trainer/voice.ts                 # createVoiceNote, transcribeVoiceNote (US3)
src/app/api/conversations/route.ts          # + trainer en la página
src/app/api/conversations/[id]/messages/route.ts        # rama trainer
src/app/api/conversations/[id]/messages/audio/route.ts  # US3
src/app/api/message-media/[id]/route.ts     # US3, autenticado + Range
src/app/api/trainer/changes/route.ts · changes/[id]/revert/route.ts · clear/route.ts
src/app/api/kb/* · agent/profile · lab/suggestions/apply   # usan los servicios
src/components/inbox/{inbox-client,conversation-list,composer,message-thread}.tsx
src/components/inbox/trainer-row.tsx · trainer-panel.tsx · use-voice-recorder.ts
src/components/agent/agent-client.tsx       # chip source
src/components/settings/ai-card.tsx         # transcriptionModel (US3)
src/server/dev/ai-mock.ts                   # rama [ENTRENADOR] + transcripción
public/pcm-recorder-worklet.js              # fallback WAV (US3)
tests/unit/*.test.ts · tests/e2e/015-*.md · tests/e2e/fixtures/nota-de-voz.wav
```

**Structure Decision**: monolito existente; el entrenador vive en
`src/server/trainer/` (dominio) + `src/server/ai/trainer*.ts` (LLM), sin
tocar `AgentAction` ni el pipeline de clientes salvo un guard.

## Complexity Tracking

Sin violaciones.
