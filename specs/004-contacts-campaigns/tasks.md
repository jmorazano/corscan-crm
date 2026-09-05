# Tasks: Contactos importados + Campañas de plantillas

**Input**: Design documents from `/specs/004-contacts-campaigns/`

**Prerequisites**: plan.md, spec.md, research.md (D1–D12), data-model.md, contracts/

**Tests**: la Definición de Hecho REFORZADA exige unit tests de la lógica
nueva + guiones E2E conducidos; se incluyen como tareas.

**Organization**: por user story; cada historia queda verificable por sí
sola con su guion.

## Phase 1: Setup

- [x] T001 Instalar dependencias nuevas: `pnpm add read-excel-file papaparse libphonenumber-js && pnpm add -D @types/papaparse`; verificar lockfile y que `pnpm build` sigue verde (build se verifica en T038)
- [x] T002 [P] Variables de entorno: `CAMPAIGN_PACE_MS` en `.env` (dev: 200) y `.env.example` (guía inline, default 4000); documentar que NO es secreto
- [x] T003 [P] Script generador de fixtures `tests/e2e/fixtures/generate.py` (openpyxl local; crea `contactos.csv` y `contactos.xlsx` con 12 filas: AR en 3 formatos del MISMO número, duplicado interno, 2 inválidos, fila sin nombre) — fixtures commiteados

## Phase 2: Foundational (bloquea todas las historias)

- [ ] T004 Schema Drizzle en `src/lib/db/schema.ts`: columnas nuevas de `contact` (tags text[], consent_source, consent_at, opted_out_at, opt_out_reverted_at/by) + tablas `campaign`, `campaign_recipient`, `initiated_send`, `send_settings` según data-model.md (índices y uniques incluidos) → `pnpm db:generate` → migración `drizzle/0004_*`
- [ ] T005 [P] Librería compartida de teléfonos `src/lib/phone.ts`: `normalizeToWaId(input, defaultCountry='AR')` con libphonenumber-js + post-proceso AR (+54→+549), reglas de rechazo por ambigüedad, y absorber/extender `normalizeRecipient` de `src/lib/meta/client.ts` (MX 521) sin romper call sites
- [ ] T006 [P] Unit tests de normalización en `tests/unit/phone.test.ts`: los 3 formatos AR convergen a 549…, MX, E.164 genérico, inválidos con motivo (basado en la evidencia empírica de research D3)

**Checkpoint**: migración aplica sobre BD dev; phone.ts verde.

## Phase 3: User Story 1 — Cargar mi lista (alta manual + import) (P1) 🎯 MVP

**Goal**: la lista del dueño (Excel/CSV) entra al CRM con tags y
consentimiento; alta manual desde la UI.

**Independent Test**: guion `us-cc-1-contactos-import.md` completo.

- [ ] T007 [US1] Servicio de import `src/server/contacts/import.ts`: upsert masivo por (org, phone) con merge (tags unión saneada; name/notes solo si vacíos; consent solo si NULL; jamás toca opted_out_at), reporte {created, updated, invalid[{index, reason}]}, tope 5.000 filas
- [ ] T008 [US1] Endpoint `POST /api/contacts/import` en `src/app/api/contacts/import/route.ts` (withAuth + Zod, `consentDeclared` obligatorio, re-normaliza server-side con `src/lib/phone.ts`) según contracts/contacts-import.md
- [ ] T009 [US1] Extender contactos API: `POST /api/contacts` (tags + consent manual + normalización), `PATCH /api/contacts/[id]` (tags), `GET /api/contacts` (tags, consentSource, optedOutAt, filtro ?tag=) en `src/app/api/contacts/`
- [ ] T010 [US1] Estampar consentimiento inbound (FR-007): hook `src/server/inbox/side-effects.ts` llamado desde `ingestInboundMessage` tras el gate de dedup (`src/server/inbox/ingest.ts:181`) — consent_source='inbound' set-si-null (cubre contactos preexistentes)
- [ ] T011 [US1] UI alta manual: modal "Nuevo contacto" (patrón EditDialog) + botón en header de `src/components/contacts/contacts-client.tsx`; tags visibles/editables en lista y edición
- [ ] T012 [US1] UI wizard de import `src/components/contacts/import-wizard.tsx`: input de archivo → parse en navegador (read-excel-file/browser + papaparse) → detección de columnas por encabezado (sinónimos ES/EN) → normalización con `src/lib/phone.ts` → vista previa (válidas/inválidas con motivo) → checkbox de declaración de consentimiento → POST → reporte final
- [ ] T013 [P] [US1] Unit tests `tests/unit/contacts-import.test.ts`: merge de tags, no pisar nombre editado, idempotencia de re-import, tope de filas, consent_required
- [ ] T014 [US1] Guion `tests/e2e/us-cc-1-contactos-import.md` escrito y CONDUCIDO en local (xlsx + csv + idempotencia + convergencia AR + camino infeliz archivo corrupto)

**Checkpoint**: US1 verificada — la lista real puede entrar hoy.

## Phase 4: User Story 2 — Saliente individual a contacto nuevo (P2)

**Goal**: plantilla aprobada a un contacto sin conversación; el hilo nace en
la bandeja.

**Independent Test**: guion `us-cc-2-saliente.md`.

- [ ] T015 [US2] Refactor `src/server/whatsapp/templates.ts`: extraer núcleo `sendTemplateCore` que reciba template + creds pre-resueltos (guards intactos: approved, {{1}}, sandbox is_test, credenciales); `sendTemplate` actual lo envuelve sin cambio de contrato
- [ ] T016 [US2] Módulo de cupo `src/server/campaigns/quota.ts`: `getQuota(orgId)` (límite de send_settings o 250; usado = COUNT DISTINCT contact en initiated_send últimas 24h), `assertQuota`, `recordInitiatedSend(orgId, contactId)`; mutex in-process por org (patrón __agentCoalesce)
- [ ] T017 [US2] Endpoint `POST /api/conversations` en `src/app/api/conversations/route.ts`: guards del contrato (opted_out 409, template 422, quota 429 con retryInSeconds, sandbox 403) → getOrCreateContact/getOrCreateConversation (reuso ingest) → sendTemplateCore → recordInitiatedSend → reconciliación `contacts[0].wa_id` (update phone si libre; si colisiona, responder ok con aviso `wa_id_conflict`)
- [ ] T018 [US2] Cupo compartido en el sender existente: `sendTemplate` (conversación con ventana cerrada) registra initiated_send y respeta el cupo (SendError → 429 `quota_exceeded` en `src/app/api/conversations/[id]/messages/template/route.ts`)
- [ ] T019 [US2] UI: acción "Enviar plantilla" en la ficha/lista de contactos sin conversación (`src/components/contacts/contacts-client.tsx`, reusando el selector de `src/components/inbox/template-sender.tsx` o extrayéndolo a componente compartido); al éxito navega a la conversación
- [ ] T020 [P] [US2] Unit tests `tests/unit/quota.test.ts`: ventana móvil (mismo contacto 2 envíos = 1 cupo), límite custom, expiración a las 24h
- [ ] T021 [US2] Guion `tests/e2e/us-cc-2-saliente.md` escrito y CONDUCIDO (ticks vía mock, reintento sin duplicar, no aprobada rechaza, respuesta entra al mismo contacto)

**Checkpoint**: US1+US2 — outbound individual operativo.

## Phase 5: User Story 3 — Opt-out automático (P3)

**Goal**: "BAJA"/"STOP" excluye al contacto de todo envío iniciado; visible
y reversible con confirmación.

**Independent Test**: guion `us-cc-3-optout.md`.

- [ ] T022 [US3] Extender `src/server/inbox/side-effects.ts`: detección BAJA/STOP (solo type text, trim+upper, match exacto) → opted_out_at set-si-null + `campaign_recipient` pending del contacto → skipped(opted_out); "respondió" → replied_at set-si-null en recipients enviados del contacto; todo org-scoped e idempotente ante re-entregas
- [ ] T023 [US3] Endpoint `POST /api/contacts/[id]/opt-out-revert` en `src/app/api/contacts/[id]/opt-out-revert/route.ts` (409 not_opted_out; estampa reverted_at/by) + guard opted_out en POST /api/conversations ya cubierto por T017
- [ ] T024 [US3] UI: badge "Dado de baja" en lista y edición de contactos, botón revertir con confirmación explícita (`src/components/contacts/contacts-client.tsx`); bloquear la acción "Enviar plantilla" para dados de baja
- [ ] T025 [P] [US3] Unit tests `tests/unit/optout.test.ts`: keywords exactas (con espacios/case), frase larga NO dispara, set-si-null idempotente, skip de pendientes
- [ ] T026 [US3] Guion `tests/e2e/us-cc-3-optout.md` escrito y CONDUCIDO (BAJA en vivo por wa-mock, UI, revert, bloqueo de envío)

**Checkpoint**: guardrail listo — recién ahora se habilitan campañas.

## Phase 6: User Story 4 — Campañas con freno y tracking (P4)

**Goal**: campaña a segmento por tags con throttling, cupo 24h, pausa/
reanudar/cancelar, revive tras reinicio y progreso en vivo.

**Independent Test**: guion `us-cc-4-campanas.md`.

- [ ] T027 [US4] `src/server/campaigns/recipients.ts`: query de elegibilidad (consent NOT NULL, sin baja, sin archivo, tags && filter o filtro vacío), `previewSegment(orgId, tags)` y `freezeRecipients(campaignId)` (insert masivo idempotente por unique campaign+contact)
- [ ] T028 [US4] `src/server/campaigns/runner.ts`: `executeCampaign(id)` fire-and-forget con cancelación cooperativa y guards WHERE monotónicos (patrón lab/runner.ts); por fila: re-verificar elegibilidad → mutex de cupo → pending→sending → sendTemplateCore → persistir wa_message_id → sent + recordInitiatedSend → SSE; pacing CAMPAIGN_PACE_MS + jitter; fallos: 1 retry transitorio, permanente→failed, reconnect/not_connected→paused(channel); cupo agotado→paused(daily_limit); sin pendientes→completed
- [ ] T029 [US4] Revive y reanudación: `src/instrumentation-node.ts` re-lanza executeCampaign para campañas running al boot (sending CON wamid→sent, SIN wamid→re-intentable) SIN tocar cleanupOrphanRuns del Lab; ticker in-process que reanuda paused(daily_limit) cuando la ventana libera cupo
- [ ] T030 [US4] APIs de campañas según contracts/campaigns-api.md: `src/app/api/campaigns/route.ts` (GET/POST), `campaigns/[id]/route.ts` (GET detalle + recipients con deliveryStatus por JOIN a message), `campaigns/[id]/actions/route.ts` (launch/pause/resume/cancel, 409 invalid_transition, 422 segment_empty), `campaigns/segment-preview/route.ts`
- [ ] T031 [US4] Ajustes de envío: `src/app/api/settings/sending/route.ts` (GET con usedLast24h/available, PUT upsert) + tarjeta "Envíos y campañas" en Ajustes (`src/app/(app)/settings/` + `src/components/settings/`) según contracts/settings-sending.md
- [ ] T032 [US4] SSE: variante `campaign.progress` en `src/server/events/bus.ts` + handler en `src/components/use-events.ts`
- [ ] T033 [US4] UI Campañas: entrada NAV (`src/components/app-nav.tsx`, icono Megaphone) + `src/app/(app)/campaigns/page.tsx` + `src/components/campaigns/campaigns-client.tsx` (lista con estados/counts, crear con preview de segmento y variable, detalle con progreso vivo y tabla de destinatarios, acciones pausar/reanudar/cancelar con confirmación)
- [ ] T034 [P] [US4] Unit tests `tests/unit/campaign-runner.test.ts`: transiciones monotónicas, revive (sending±wamid), pausa por cupo, skip por opt-out sobrevenido, elegibilidad
- [ ] T035 [US4] Guion `tests/e2e/us-cc-4-campanas.md` escrito y CONDUCIDO (throttling observable, pausa por límite y reanudación, reinicio del dev server sin duplicados verificado contra outbox, fallo aislado, respondió, SSE en vivo)

**Checkpoint**: las 4 historias verificadas por guion.

## Phase 7: Polish & Cross-Cutting

- [ ] T036 [P] Docs: CLAUDE.md (filas nuevas en el mapa: campañas/import/cupo; sección env), README/INSTALL si mencionan contactos/plantillas, `.env.example` final
- [ ] T037 [P] Regresión E2E: re-conducir us1 (bandeja), us6 (plantillas ahora con cupo), us-mt-2 (aislamiento: campañas/cupo/contactos de A invisibles desde B)
- [ ] T038 Gate técnico completo con dev server apagado: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
- [ ] T039 Memoria: gotchas nuevos (regla AR del 9, semántica del cupo, revive del runner) en `memory/`

## Dependencies & Execution Order

- Setup (T001–T003) → Foundational (T004–T006) → historias en orden P1→P4.
- US2 depende de phone.ts (T005) y de contactos importados para probarse
  (US1). US3 toca `side-effects.ts` creado en T010 (US1). US4 depende de
  T015–T016 (US2: core de envío + cupo) y del guardrail de US3.
- El orden de entrega es secuencial (un solo implementador); [P] marca lo
  paralelizable dentro de cada fase (archivos distintos).

## Implementation Strategy

MVP = US1 (la lista entra al CRM). Cada historia cierra con su guion
conducido ANTES de pasar a la siguiente (checkpoints); el gate técnico
completo corre al final (T038) y por fase si hay dudas. Commit por tarea o
grupo lógico.
