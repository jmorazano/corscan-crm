# Tasks — 026 Enviar imágenes, archivos y videos desde la Bandeja

## Fase 0 — Datos y reglas puras

- [x] T0 Migración 0022: `message_media.file_name`.
- [x] T1 `src/lib/outbound-media.ts` (clasificación, matriz por canal,
      nombre, disposición, marcador saliente) + tests.
- [x] T2 `src/lib/media-link.ts` (firmar/verificar) + tests.
- [x] T3 `MessageMediaDto` con `fileName`/`sizeBytes`; helper único para
      armarlo; todos los sitios que lo construyen.

## Fase A — Envío (servidor)

- [x] A1 `graphRequest` con `form` + `uploadWhatsAppMedia` + tests.
- [x] A2 `sendInstagramAttachment` + tests.
- [x] A3 `src/server/inbox/send-media.ts`: guardas, guardar, entregar,
      epígrafe aparte, reintentar.
- [x] A4 Rutas `POST …/messages/media` y `POST …/messages/[messageId]/retry`.
- [x] A5 `/api/media-link/[id]` pública firmada.
- [x] A6 `/api/message-media/[id]`: disposición segura, `nosniff`,
      `?download=1`.
- [x] A7 SSE `message.status` con `error`; 131053 en `meta-errors.ts`.
- [x] A8 Historial del agente: marcador de adjunto saliente.

## Fase B — Entrantes video/documento

- [x] B1 Plan `store` en `planInboundMedia` + tests (ajustar los de 020).
- [x] B2 `processInboundMedia` con `store` + `filename`; ingesta WhatsApp e
      Instagram dispara el turno en el acto.

## Fase C — UI

- [x] C1 Composer: clip en modo canal, adjunto pendiente, pegar/arrastrar,
      progreso, errores.
- [x] C2 `inbox-client`: `sendMedia` por XHR, reintentar, `error` por SSE.
- [x] C3 Hilo: video, documento, audio saliente, textos de imagen enviada,
      Reintentar.

## Fase D — Mocks y verificación

- [x] D1 wa-mock: `POST {pn}/media`, validación del id en `/messages`,
      knob `mediaUploadFails`, binarios de video/documento, `filename` en
      entrantes.
- [x] D2 ig-mock: `message.attachment` (baja la URL), eco con adjunto.
- [x] D3 Gate: typecheck + lint + build + unit.
- [x] D4 Guion `tests/e2e/026-outbound-media.md` conducido con mocks.
- [x] D5 CLAUDE.md (mapa + feature activa) y memoria.
- [ ] D6 Merge fast-forward a `main` + deploy + verificación en producción.

## Estado

30-sep-2026: A–D5 hechas. Gate verde (typecheck, lint, 1.263+ unit,
build) y guion `tests/e2e/026-outbound-media.md` conducido con mocks
(WhatsApp, Instagram, entrantes, rechazos, fallos con Reintentar, miembro,
móvil). Pendiente D6: merge + deploy (autorizado por el dueño).
