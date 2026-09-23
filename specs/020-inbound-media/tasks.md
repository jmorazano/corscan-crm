# Tasks — 020 El agente ve y escucha

## Fase 1 — Base

- [x] T1 `src/lib/inbound-media.ts` puro: tipos con adjunto, topes,
      `attachmentMarker()`, normalización de mime + unit tests.
- [x] T2 Migración 0016: `message.media_state`, `message.media_summary`.
      Regenerar con `db:generate`.
- [x] T3 `src/lib/meta/client.ts`: `fetchMediaHandle` + `downloadMediaBinary`
      con allowlist de host y User-Agent propio + unit tests de la allowlist.
- [x] T4 `src/lib/ai/index.ts`: `ContentPart` con `image_url`, `describeImage`
      con el prompt que prohíbe datos sensibles.

## Fase 2 — Ingesta y proceso

- [x] T5 `ingest.ts`: leer `media_id`, `mime_type`, `caption` y `filename`
      del webhook; nacer `media_state='pending'`; NO disparar el turno.
- [x] T6 `src/server/inbox/media.ts`: `processInboundMedia` (descarga →
      guarda → transcribe/describe → publica → opt-out → turno).
- [x] T7 `pipeline.ts`: inyectar el marcador del adjunto al historial.
- [x] T8 Migrar el entrenador (`trainer/voice.ts`) a `media_state`.

## Fase 3 — UI

- [x] T9 `MessageDto`: `mediaState`, `mediaSummary`. Serializador + queries.
- [x] T10 `message-thread.tsx`: audio entrante (reproductor +
      transcripción), imagen (miniatura + lightbox), resumen de IA,
      nombre de archivo del documento.

## Fase 4 — Mocks y verificación

- [x] T11 wa-mock: `GET /{media-id}` + binario servido; knobs
      `mediaDownloadFails`, `mediaTooLarge`.
- [x] T12 ai-mock: rama `image_url` → descripción fija de comprobante.
- [x] T13 Guion E2E `tests/e2e/020-inbound-media.md` + conducción con
      Playwright hasta verde.
- [x] T14 Gate: `typecheck && lint && build && test`.

## Estado

Todas completas. Guion conducido y verde: `tests/e2e/020-inbound-media.md`
(23-sep-2026). Gate: typecheck + lint + build + 940 tests.
