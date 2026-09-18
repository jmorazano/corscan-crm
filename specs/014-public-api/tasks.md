# Tasks: API pública por empresa (014)

**Input**: specs/014-public-api/spec.md + plan.md + data-model.md + contracts/api.md

## Phase 1: Fundaciones

- [x] T001 Tablas `api_key`, `api_request`, columna `message.api_key_id`, valor `api` en consent, prefijos `ak_`/`areq_` en src/lib/db/schema.ts + src/lib/db/ids.ts + migración drizzle/0011_odd_aqueduct.sql
- [x] T002 [P] Puro: generar/hashear/prefijo de clave en src/lib/api-keys.ts + tests/unit/api-keys.test.ts (5)
- [x] T003 [P] Puro: `validateParamValue` + uso en `resolveVariableValues` en src/lib/template-body.ts (+ tests en public-api-templates.test.ts)
- [x] T004 `withApiKey` (Bearer → empresa, 401, rate limit 429, last_used) en src/lib/api.ts + src/server/api-keys/keys.ts + tests/unit/with-api-key.test.ts (6)

## Phase 2: US1 — Claves y guía en Ajustes → API

- [x] T005 [US1] Rutas internas `GET/POST /api/settings/api-keys`, `DELETE /api/settings/api-keys/[id]` (owner)
- [x] T006 [US1] Página `/settings/api` + `api-client.tsx` (claves, secreto una vez, revocar con confirmación, estado del canal y cupo, guía con curl por plantilla) + pestaña en settings-nav.tsx; `src/lib/public-templates.ts` (puro, compartido con la API)

## Phase 3: US2 — Listar y enviar

- [x] T007 [US2] `src/server/public-api/templates.ts`: serialización pública, resolución por nombre/idioma, `resolveApiParams` + tests/unit/public-api-templates.test.ts (11)
- [x] T008 [US2] `sendTemplateCore` acepta `via`; `serializeMessage(m, via)` + LEFT JOIN en listMessages; `MessageDto.via`; etiqueta «Enviado por API · nombre» en message-thread.tsx
- [x] T009 [US2] `src/server/public-api/send.ts` (idempotencia reserva-primero, contacto/consent/nombre, conversación, baja, cupo, envío, reconciliación) + `src/app/api/v1/templates/route.ts` + `src/app/api/v1/messages/route.ts`
- [x] T010 [US2] Knob `failNextSend` en wa-mock (state + knobs + graph)

## Phase 4: US3 — Estado del mensaje

- [x] T011 [US3] `src/server/public-api/messages.ts` + `src/app/api/v1/messages/[id]/route.ts`

## Phase 5: US4 — Silencio del agente ante acuses de recibo

- [x] T012 [US4] `isPlainAcknowledgment` en src/server/ai/acknowledgment.ts + `transactionalContext` puro en pipeline.ts + tests/unit/acknowledgment.test.ts (27)
- [x] T013 [US4] Corte + sección «NOTIFICACIÓN AUTOMÁTICA» en pipeline.ts/prompts.ts; regla determinista en ai-mock

## Phase 6: Docs, verificación y cierre

- [x] T014 docs/api/v1.md + fila del mapa en CLAUDE.md + feature activa
- [x] T015 Guion tests/e2e/014-public-api.md ejecutado en verde el 18-sep-2026 (feliz + infeliz: 401, 422×8, 404, 409 baja, 429 cupo y rate limit, 503 Meta caída con reintento idempotente, agente mudo/atento, UI móvil, revocación)
- [x] T016 Gate técnico completo (typecheck + lint + build + test) + memoria
