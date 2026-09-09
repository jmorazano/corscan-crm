# Implementation Plan: Motivo de fallo visible y reintento de fallidos

**Branch**: `010-campaign-retry` | **Date**: 2026-09-09 | **Spec**: [spec.md](spec.md)

## Summary

(1) `message.error` ya existe y el detalle de campaña ya joinea
`deliveryError`: falta EXPONERLO — `serializeMessage` suma `error`, la
burbuja de la bandeja muestra tooltip + línea breve, y el detalle de campaña
muestra el motivo por fallido, todo traducido por un helper puro nuevo
`friendlyDeliveryError` (`src/lib/meta-errors.ts`). (2) Acción nueva
`retry_failed` en `/api/campaigns/[id]/actions`: resetea a `pending` los
destinatarios fallidos de AMBAS clases — `recipient.status='failed'` (rechazo
al enviar) y `status='sent'` con `message.status='failed'` (fallo de entrega,
limpiando message_id/wa_message_id/sent_at para que el reenvío cree mensaje
nuevo) — y devuelve la campaña `completed|paused → running`
(runnerGeneration+1, `spawnCampaignRunner`), reusando runner/cupo/guardas
tal cual. Sin migraciones.

## Technical Context

**Storage**: sin cambios de esquema (columnas existentes).

**Testing**: unit (helper de traducción + SQL del reset vía lógica en
`manage.ts` probada con mock de db o en E2E) + guion E2E
`tests/e2e/010-campaign-retry.md` con wa-mock (el knob de status ya permite
`failed`; se le agrega `error` opcional al payload para probar la traducción).

**Constraints**: monotonicidad de estados — la transición `failed→pending`
es una EXCEPCIÓN deliberada, solo alcanzable por la acción guardada (WHERE
por estado de origen, idempotente); constitución completa; cancelados
(`skipped`) jamás se reintentan.

## Constitution Check

PASA: sin dependencias nuevas (II); todo scoped (III); acción idempotente y
transiciones guardadas por estado de origen (IV); sandbox intacto (el
reintento pasa por `sendTemplateCore` con sus guardas).

## Archivos

```text
src/lib/meta-errors.ts                       # NUEVO: friendlyDeliveryError() puro
src/server/inbox/ingest.ts                   # serializeMessage + error
src/lib/types.ts                             # MessageDto.error
src/components/inbox/message-thread.tsx      # tooltip + línea de motivo en fallidos
src/server/campaigns/manage.ts               # retryFailedRecipients(campaign) → n reseteados
src/app/api/campaigns/[id]/actions/route.ts  # action "retry_failed"
src/components/campaigns/campaigns-client.tsx# detalle: motivo por fallido + botón Reintentar (confirmación)
src/server/dev/wa-mock-inbound.ts + status   # error opcional en el payload de status del mock
tests/unit/meta-errors.test.ts               # traducciones
tests/e2e/010-campaign-retry.md              # guion E2E
```

## Fases

Setup no aplica (sin esquema). Foundational: helper puro + mock. US1: motivo
visible (bandeja + campaña). US2: acción retry + botón. Polish: E2E + gate +
CLAUDE.md.
