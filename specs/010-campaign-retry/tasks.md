# Tasks: Motivo de fallo visible y reintento de fallidos

**Input**: specs/010-campaign-retry/ (spec.md, plan.md)

## Phase 1: Foundational

- [x] T001 [P] Helper puro `friendlyDeliveryError(raw)` con traducciones de los errores comunes de Meta (pago, límite de marketing 131049, inalcanzable, ventana) en src/lib/meta-errors.ts + unit tests en tests/unit/meta-errors.test.ts
- [x] T002 [P] wa-mock: `POST /api/dev/wa-mock/status` acepta `error` opcional y lo incluye en `statuses[].errors` en src/server/dev/wa-mock-inbound.ts + src/app/api/dev/wa-mock/status/route.ts

## Phase 2: US1 — Motivo visible (P1)

- [x] T003 [US1] `serializeMessage` expone `error`; `MessageDto.error` en src/server/inbox/ingest.ts + src/lib/types.ts
- [x] T004 [US1] Burbuja de la bandeja: ⚠ con `title`/aria del motivo traducido + línea breve «No entregado: …» bajo el mensaje fallido en src/components/inbox/message-thread.tsx
- [x] T005 [US1] Detalle de campaña: cada destinatario fallido muestra su motivo (recipient.error o deliveryError, traducido) en src/components/campaigns/campaigns-client.tsx

## Phase 3: US2 — Reintentar fallidos (P1)

- [x] T006 [US2] `retryFailedRecipients(campaign)` en src/server/campaigns/manage.ts: resetea a pending los `status='failed'` (error null) y los `sent` con mensaje `failed` (limpia message_id/wa_message_id/sent_at); devuelve n; idempotente
- [x] T007 [US2] Acción `retry_failed` en src/app/api/campaigns/[id]/actions/route.ts: guardas completed|paused, 422 sin fallidos, transición a running + runnerGeneration+1 + spawnCampaignRunner + publishProgress
- [x] T008 [US2] Botón «Reintentar fallidos (N)» con confirmación en el detalle (visible si status completed|paused y N>0) en src/components/campaigns/campaigns-client.tsx

## Phase 4: Polish & verificación reforzada

- [x] T009 Guion E2E tests/e2e/010-campaign-retry.md: campaña a 2 contactos → 1 entregado + 1 fallido (mock status failed con error de marketing) → motivo visible en burbuja y detalle → reintentar → solo el fallido recibe nuevo envío → completed; doble reintento sin duplicados; sin fallidos → 422
- [x] T010 Gate técnico completo + CLAUDE.md (fila del mapa)

## Dependencies

T001,T002 → US1/US2 en paralelo → Polish.
