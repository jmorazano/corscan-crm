# Implementation Plan: Historial del celular (017)

**Branch**: `017-whatsapp-history` | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

## Summary

Pedir a Meta la sincronización de coexistence (`smb_app_data`), ingerir
los webhooks `history` (mensajes de hasta 180 días, filtrados a 60),
`smb_message_echoes` (lo que el dueño manda desde el celular) y
`smb_app_state_sync` (nombres de agenda) por un camino propio que no
dispara efectos de un entrante real, con estado por empresa y tarjeta en
Ajustes → WhatsApp; el agente calla si lo último ya es del negocio.

## Technical Context

**Language/Version**: TypeScript estricto, Next.js 15, React 19
**Primary Dependencies**: Drizzle, Zod, cliente Graph propio — sin
dependencias nuevas
**Storage**: tabla `history_import`, columna `message.source`
**Testing**: Vitest + guion `tests/e2e/017-whatsapp-history.md` con wa-mock
**Constraints**: webhooks de miles de mensajes → inserción en lotes;
`created_at` = fecha original; sin efectos de entrante; ventana de 24 h de
Meta para pedir la sync

## Constitution Check

- **I**: token solo en el servidor; errores de Meta redactados. ✅
- **II**: misma Cloud API; sin servicios nuevos. ✅
- **III**: ruteo por `phone_number_id` → org; todo `scoped()`. ✅
- **IV**: dedup `(org, wamid)`; `greatest()` en las marcas de la
  conversación; reintentar la sync es idempotente. ✅
- **V/IX**: unit + E2E con mock (chunks desordenados, media, rechazo,
  ecos, nombres). ✅

## Decisiones de diseño

- **D1 Camino propio**: `src/server/inbox/history.ts` NO reutiliza
  `ingestInboundMessage` (bumpearía no leídos/ventana, crearía leads,
  evaluaría BAJA, notificaría y dispararía al agente). Reutiliza
  `getOrCreateContact`/`getOrCreateConversation`.
- **D2 Orden**: insertar con `created_at = timestamp` original → el hilo,
  el preview y el cursor quedan correctos sin tocar queries.
- **D3 Filtro de días**: Meta no acota; se descarta en la ingesta lo
  anterior a `history_import.days` (default 60).
- **D4 Dirección/estado**: `from === display_phone_number` (dígitos) →
  `out` con estado mapeado (READ/PLAYED→read, DELIVERED→delivered,
  SENT→sent, PENDING→pending, ERROR→failed); si no → `in`/`delivered`.
- **D5 Media**: `media_placeholder` se guarda como tipo
  `media_placeholder` («Archivo del celular»); el detalle posterior
  (mismo `wamid`) actualiza tipo y pie. Sin descarga en v1.
- **D6 Ecos**: `out`, `source='phone'`, `status=sent`, SSE `message.new`;
  y `runAgentTurn` corta si el último mensaje es `out`.
- **D7 Nombres**: `smb_app_state_sync` renombra solo si el nombre actual
  es el teléfono o el contacto vino por `inbound` (perfil de WhatsApp).
- **D8 Estado**: fila `history_import` por org; progreso = max; `done`
  al 100; `declined` con el error 2593109; `failed` si Meta rechaza la
  solicitud. SSE `conversations.updated` tras cada chunk.
- **D9 Auto-sync**: `completeEmbeddedSignup` sin `phoneNumberId`
  (coexistence) dispara `requestHistorySync` en segundo plano.

## Project Structure

```text
src/lib/history-import.ts            # puro: mapeo de mensajes, filtro de días, dirección/estado
src/server/inbox/history.ts          # processHistoryValue / processEchoesValue / processStateSyncValue
src/server/whatsapp/history-sync.ts  # requestHistorySync, estado, DTO
src/app/api/webhooks/wa/[webhookToken]/route.ts   # dispatch de los 3 campos
src/app/api/settings/whatsapp/history-import/route.ts  # GET estado / POST pedir
src/components/settings/whatsapp-wizard.tsx        # tarjeta «Historial del celular»
src/components/inbox/message-thread.tsx · helpers.ts  # «Desde el celular», «Archivo del celular»
src/server/ai/pipeline.ts            # corte si lo último es del negocio
src/server/inbox/webhook.ts          # tipos de los payloads
src/server/dev/wa-mock-inbound.ts · wa-mock-state.ts · api/dev/wa-mock/{graph,echo}  # mock
src/lib/db/schema.ts · ids.ts · drizzle/0014_*
tests/unit/history-import.test.ts · tests/e2e/017-whatsapp-history.md
```

## Complexity Tracking

Sin violaciones.
