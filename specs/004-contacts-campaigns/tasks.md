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

- [x] T004 Schema Drizzle en `src/lib/db/schema.ts`: columnas nuevas de `contact` (tags text[] + GIN, consent_source/consent_at, opted_out_at + auditoría de reversión, **is_test**) + tablas `campaign` (con **runner_generation** y paused_reason incl. `error`), `campaign_recipient`, `initiated_send`, `send_settings` → migración `drizzle/0004_gifted_justice.sql` CON backfills: marca is_test de contactos del Lab (por sus conversaciones is_test) y consentimiento 'inbound' histórico con fecha del primer inbound (FR-007)
- [x] T005 [P] Librería compartida de teléfonos `src/lib/phone.ts`: `normalizeToWaId(input, defaultCountry='AR')` con libphonenumber-js + post-procesos AR (+54→+549) y MX espejo (52→521, con pre-strip para parsear el legacy); `normalizeRecipient` de `src/lib/meta/client.ts` queda intacto (es transform de SALIDA)
- [x] T006 [P] Unit tests de normalización en `tests/unit/phone.test.ts` (13 verdes): 3 formatos AR convergen a 549…, MX 521 en ambos sentidos, E.164 genérico, inválidos con motivo
- [ ] T040 Backfill de teléfonos preexistentes al boot (re-ejecutable, research D3): módulo `src/server/contacts-backfill.ts` invocado desde `src/instrumentation-node.ts` — normaliza `contact.phone` no canónicos con `src/lib/phone.ts`; colisión con otra fila de la org → deja como está + console.warn; idempotente

**Checkpoint**: migración aplica sobre BD dev; phone.ts verde.

## Phase 3: User Story 1 — Cargar mi lista (alta manual + import) (P1) 🎯 MVP

**Goal**: la lista del dueño (Excel/CSV) entra al CRM con tags y
consentimiento; alta manual desde la UI.

**Independent Test**: guion `us-cc-1-contactos-import.md` completo.

- [ ] T007 [US1] Servicio de import `src/server/contacts-import.ts` (archivo, NO directorio — ya existe el módulo `src/server/contacts.ts` homónimo): upsert masivo por (org, phone) con merge (tags unión saneada; name/notes solo si vacíos; consent solo si NULL; jamás toca opted_out_at), fila con teléfono de contacto `is_test` → invalid `contacto_de_prueba`, reporte {created, updated, invalid[{index, phone?, reason}]}, tope 5.000 filas
- [ ] T008 [US1] Endpoint `POST /api/contacts/import` en `src/app/api/contacts/import/route.ts` (withAuth + Zod, `consentDeclared` obligatorio, re-normaliza server-side con `src/lib/phone.ts`) según contracts/contacts-import.md
- [ ] T009 [US1] Extender contactos API en `src/app/api/contacts/`: `POST /api/contacts` (tags + consent manual + normalización con phone.ts), `PATCH /api/contacts/[id]` (tags; desarchivar contacto `is_test` → 403 sandbox_violation), `GET /api/contacts` (tags, consentSource, optedOutAt, filtro ?tag=, archivados/búsqueda al WHERE — hoy filtra en JS DESPUÉS del limit(200) — y campo `total`)
- [ ] T010 [US1] Estampar consentimiento inbound para mensajes NUEVOS (FR-007; los preexistentes los cubrió el backfill de la migración T004): hook `src/server/inbox/side-effects.ts` llamado desde `ingestInboundMessage` tras el gate de dedup (`src/server/inbox/ingest.ts:181`) — consent_source='inbound' set-si-null (jamás pisa 'import'/'manual')
- [ ] T011 [US1] UI alta manual: modal "Nuevo contacto" (patrón EditDialog) + botón en header de `src/components/contacts/contacts-client.tsx`; tags visibles/editables en lista y edición
- [ ] T012 [US1] UI wizard de import `src/components/contacts/import-wizard.tsx`: input de archivo → parse en navegador (read-excel-file/browser + papaparse) → detección de columnas por encabezado en módulo compartido TESTEABLE `src/lib/import-columns.ts` (sinónimos ES/EN; tolera encabezados en fila 2 y hoja vacía con error claro) → normalización con `src/lib/phone.ts` → vista previa (válidas/inválidas con motivo) → checkbox de declaración de consentimiento → POST → reporte final
- [ ] T013 [P] [US1] Unit tests `tests/unit/contacts-import.test.ts` + `tests/unit/import-columns.test.ts`: merge de tags, no pisar nombre editado, idempotencia de re-import, tope de filas, consent_required, consent inbound set-si-null no pisa import/manual, rechazo is_test, sinónimos de columnas / fila 2 / hoja vacía
- [ ] T014 [US1] Guion `tests/e2e/us-cc-1-contactos-import.md` escrito y CONDUCIDO en local (pasos según quickstart: alta duplicada avisa, xlsx + csv, idempotencia, nombre editado intacto tras re-import, convergencia AR, paso CRONOMETRADO con contactos-5000.xlsx < 2 min (SC-001), caminos infelices: corrupto / hoja vacía / encabezados fila 2)

**Checkpoint**: US1 verificada — la lista real puede entrar hoy.

## Phase 4: User Story 2 — Saliente individual a contacto nuevo (P2)

**Goal**: plantilla aprobada a un contacto sin conversación; el hilo nace en
la bandeja.

**Independent Test**: guion `us-cc-2-saliente.md`.

- [ ] T015 [US2] Refactor de envío: `callGraphSend` (`src/server/inbox/send.ts`) devuelve `{ waMessageId, waId }` tipando `contacts[0].wa_id` (ajustar sus 2 call sites); en `src/server/whatsapp/templates.ts` extraer núcleo `sendTemplateCore` que reciba template + creds pre-resueltos y devuelva `{ messageId, waMessageId, waId }`, con guards intactos (approved, {{1}}, sandbox conversation.is_test, credenciales) MÁS dos nuevos: `contact.is_test` → sandbox_violation, y opted_out con ventana cerrada → SendError `opted_out` (FR-010/FR-012)
- [ ] T016 [US2] Módulo de cupo `src/server/campaigns/quota.ts`: mutex FIFO REAL por org (cadena de promesas en globalThis — el patrón __agentCoalesce NO sirve, es un coalesce); `reserveQuota(orgId, contactId)` dentro del mutex: exento si el contacto ya tiene initiated_send en la ventana (FR-015), si no verifica COUNT DISTINCT < límite (send_settings o 250) e INSERTA la reserva ANTES de Graph; `releaseQuota(reservaId)` compensa si el envío falla; solo aplica con ventana de servicio cerrada
- [ ] T017 [US2] Endpoint `POST /api/conversations` en `src/app/api/conversations/route.ts`: guards del contrato EN ORDEN (404, is_test 403, opted_out 409, template 422, credenciales 409, dedup FR-009: saliente de la MISMA plantilla en la conversación en las últimas 24h → 200 con el messageId existente SIN re-enviar, cupo 429 con retryInSeconds solo con ventana cerrada) → getOrCreateContact/getOrCreateConversation (reuso ingest) → reserva → sendTemplateCore → reconciliación `wa_id` con guard anti-eco (skip si igual al phone o a normalizeRecipient(phone); si colisiona con otro contacto → responder con aviso `wa_id_conflict`)
- [ ] T018 [US2] Guardrails compartidos en el sender existente (`src/app/api/conversations/[id]/messages/template/route.ts` + templates.ts): con ventana cerrada exige cupo con reserva (429 `quota_exceeded`) y rechaza dados de baja (409 `opted_out`); dentro de ventana ni cupo ni bloqueo (FR-012)
- [ ] T041 [US2] Mejoras del wa-mock (tras dev-guard, 404 en prod): guardar el wamid literal en cada OutboxEntry (`src/server/dev/wa-mock-state.ts` + graph route) y knob de wa_id divergente — `to` = 52+10 dígitos → `contacts[0].wa_id` = 521… (conduce la reconciliación en E2E)
- [ ] T019 [US2] UI: acción "Enviar plantilla" en la ficha/lista de contactos sin conversación (`src/components/contacts/contacts-client.tsx`, reusando el selector de `src/components/inbox/template-sender.tsx` o extrayéndolo a componente compartido); al éxito navega a la conversación
- [ ] T020 [P] [US2] Unit tests `tests/unit/quota.test.ts`: ventana móvil (mismo contacto 2 envíos = 1 cupo), CASO BORDE usado==límite + contacto ya iniciado → pasa, reserva+compensación, límite custom, expiración a las 24h, ventana abierta no consume
- [ ] T021 [US2] Guion `tests/e2e/us-cc-2-saliente.md` escrito y CONDUCIDO (pasos según quickstart: ticks vía mock, reintento → 200 mismo messageId sin re-envío, no aprobada rechaza, contacto del Lab → 403, consentSource='inbound' en número nuevo, rama wa_id divergente MX, respuesta entra al mismo contacto)

**Checkpoint**: US1+US2 — outbound individual operativo.

## Phase 5: User Story 3 — Opt-out automático (P3)

**Goal**: "BAJA"/"STOP" excluye al contacto de todo envío iniciado; visible
y reversible con confirmación.

**Independent Test**: guion `us-cc-3-optout.md`.

- [ ] T022 [US3] Extender `src/server/inbox/side-effects.ts`: detección BAJA/STOP (solo type text, trim+upper, match exacto) → opted_out_at set-si-null + `campaign_recipient` pending del contacto → skipped(opted_out); "respondió" → replied_at set-si-null en recipients enviados del contacto; todo org-scoped e idempotente ante re-entregas
- [ ] T023 [US3] Endpoint `POST /api/contacts/[id]/opt-out-revert` en `src/app/api/contacts/[id]/opt-out-revert/route.ts` (409 not_opted_out; estampa reverted_at/by) + guard opted_out en POST /api/conversations ya cubierto por T017
- [ ] T024 [US3] UI: badge "Dado de baja" en lista y edición de contactos, botón revertir con confirmación explícita (`src/components/contacts/contacts-client.tsx`); bloquear la acción "Enviar plantilla" para dados de baja
- [ ] T025 [P] [US3] Unit tests `tests/unit/optout.test.ts`: keywords exactas (con espacios/case), frase larga NO dispara, set-si-null idempotente, skip de pendientes, guard del sender existente (ventana cerrada → opted_out; ventana abierta → permite)
- [ ] T026 [US3] Guion `tests/e2e/us-cc-3-optout.md` escrito y CONDUCIDO (BAJA en vivo por wa-mock, UI, revert con confirmación, bloqueo del envío individual Y del sender de conversación con ventana cerrada, el dado de baja vuelve a escribir → responderle funciona normal — FR-012; el paso "pendientes de campaña → skipped" se conduce en us-cc-4, que es cuando existen campañas)

**Checkpoint**: guardrail listo — recién ahora se habilitan campañas.

## Phase 6: User Story 4 — Campañas con freno y tracking (P4)

**Goal**: campaña a segmento por tags con throttling, cupo 24h, pausa/
reanudar/cancelar, revive tras reinicio y progreso en vivo.

**Independent Test**: guion `us-cc-4-campanas.md`.

- [ ] T027 [US4] `src/server/campaigns/recipients.ts`: query de elegibilidad COMPLETA (consent NOT NULL, sin baja, sin archivo, `is_test = false`, tags && filter o filtro vacío), `previewSegment(orgId, tags)` y `freezeRecipients(campaignId)` (insert masivo idempotente por unique campaign+contact)
- [ ] T028 [US4] `src/server/campaigns/runner.ts`: `executeCampaign(id)` fire-and-forget; AL ARRANCAR resuelve `sending` residuales (CON wamid→sent reponiendo initiated_send faltante; SIN wamid→failed "interrumpido por reinicio" — AT-MOST-ONCE, jamás re-envío) y captura runner_generation; por fila: claim atómico pending→sending (UPDATE guardado; 0 filas = saltar) → re-verificar status/generación (cambió → auto-terminarse) y elegibilidad (opt-out sobrevenido → skipped) → reserva de cupo bajo el mutex (solo ventana cerrada) → sendTemplateCore → persistir wa_message_id → sent → SSE; pacing CAMPAIGN_PACE_MS (getEnv) + jitter; fallos: 1 retry transitorio (reserva se mantiene), permanente → failed + releaseQuota, CIRCUIT BREAKER 3 consecutivos mismo código → paused(channel), reconnect/not_connected → paused(channel); cupo agotado → paused(daily_limit); `.catch` de excepción no manejada → paused('error') + SSE; sin pending NI sending → completed (guards WHERE monotónicos)
- [ ] T029 [US4] Revive y reanudación: `src/instrumentation-node.ts` re-lanza executeCampaign para campañas running al boot SIN tocar cleanupOrphanRuns del Lab (la resolución de `sending` vive en T028 y corre en TODO arranque, cubre también la que murió estando paused); ticker in-process que reanuda SOLO paused(daily_limit) cuando la ventana libera cupo
- [ ] T030 [US4] APIs de campañas según contracts/campaigns-api.md: `src/app/api/campaigns/route.ts` (GET con counts que fusionan failed de envío + entrega /POST), `campaigns/[id]/route.ts` (GET detalle + recipients con deliveryStatus y error por JOIN a message), `campaigns/[id]/actions/route.ts` (launch/pause/resume/cancel; pause TAMBIÉN sobre paused(daily_limit|channel|error) reescribiendo motivo a manual; pause/resume incrementan runner_generation; 409 invalid_transition, 422 segment_empty), `campaigns/segment-preview/route.ts`
- [ ] T031 [US4] Ajustes de envío: `src/app/api/settings/sending/route.ts` (GET con usedLast24h/available, PUT upsert) + tarjeta "Envíos y campañas" en Ajustes (`src/app/(app)/settings/` + `src/components/settings/`) según contracts/settings-sending.md
- [ ] T032 [US4] SSE: variante `campaign.progress` en `src/server/events/bus.ts` + handler en `src/components/use-events.ts`
- [ ] T033 [US4] UI Campañas: entrada NAV (`src/components/app-nav.tsx`, icono Megaphone) + `src/app/(app)/campaigns/page.tsx` + `src/components/campaigns/campaigns-client.tsx` (lista con estados/counts, crear con preview de segmento y variable, detalle con progreso vivo y tabla de destinatarios, acciones pausar/reanudar/cancelar con confirmación)
- [ ] T034 [P] [US4] Unit tests `tests/unit/campaign-runner.test.ts`: transiciones monotónicas, resolución at-most-once (sending CON wamid→sent+reposición de cupo; SIN wamid→failed, NUNCA re-envío), claim atómico (0 filas = skip), generación vieja → auto-terminarse, pausa por cupo, breaker de 3 consecutivos, skip por opt-out sobrevenido, elegibilidad (incl. exclusión is_test y sin-consentimiento), segment_empty
- [ ] T035 [US4] Guion `tests/e2e/us-cc-4-campanas.md` escrito y CONDUCIDO (pasos según quickstart: throttling + SSE, segmento vacío rechaza, sin-consentimiento excluido del congelado, BAJA a mitad de campaña → skipped y sin wamid en outbox, cupo compartido individual+campaña con límite 2, pausa por límite + reanudación automática, pausa manual sobre paused(daily_limit) que el ticker respeta, cancelar, reinicio del dev server → sin duplicados VERIFICADO CONTRA LA BD (1 saliente por conversación; ambiguo queda failed), fallo de entrega asíncrono figura como fallido, respondió)

**Checkpoint**: las 4 historias verificadas por guion.

## Phase 7: Polish & Cross-Cutting

- [ ] T036 [P] Docs: CLAUDE.md (filas nuevas en el mapa: campañas/import/cupo; sección env), README/INSTALL si mencionan contactos/plantillas, `.env.example` final
- [ ] T037 [P] Regresión E2E: re-conducir us1 (bandeja) y us6 (plantillas ahora con cupo y guard de baja); EXTENDER us-mt-2 con pasos nuevos de aislamiento (campañas, cupo y ajustes de envío de A invisibles/inafectables desde B: GET /api/campaigns, /api/settings/sending y acciones sobre ids ajenos → 404) y conducirlo
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
