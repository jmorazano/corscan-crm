# Tasks — 027 Notas de voz para clientes · el agente lee PDFs · Instagram 24 h

Plan corto: ver las decisiones en `spec.md`. Fronteras: `src/lib/ogg-opus.ts`
(muxer puro), `src/lib/voice-encode.ts` (WebCodecs, cliente),
`use-voice-recorder.ts` (formato por canal), `send-media.ts` (voice +
transcripción), `src/lib/ai` (`readDocument`), `inbound-media.ts` +
`inbox/media.ts` (plan de lectura de PDF), `instagram/messaging.ts` +
`env.ts` (flag Human Agent).

## Fase A — Instagram después de 24 h

- [x] A1 `INSTAGRAM_HUMAN_AGENT` en env + `.env.example`; `instagramSendMode`
      con `humanAgentEnabled`; motivo `human_agent_unavailable`.
- [x] A2 Servidor (texto y adjuntos) y composer (`composerMode`, aviso) con
      el flag; la página pasa el flag.
- [x] A3 Traducción del rechazo «Human Agent» de Meta + tests.

## Fase B — Notas de voz

- [x] B1 `src/lib/ogg-opus.ts`: páginas Ogg (CRC), OpusHead/OpusTags,
      granulepos, muestras por TOC + tests.
- [x] B2 `src/lib/voice-encode.ts`: soporte y codificación PCM → Opus →
      OGG con WebCodecs.
- [x] B3 Grabador con formato por canal (`whatsapp` = OGG/Opus o MP4;
      `wav`).
- [x] B4 Composer: micrófono en conversaciones de canal; envío al soltar.
- [x] B5 Ruta: `voice` + `durationMs`; WhatsApp `voice: true`; duración
      guardada.
- [x] B6 Transcripción en segundo plano de audios salientes (si hay IA).
- [x] B7 Hilo: nota saliente con duración y transcripción.

## Fase C — PDFs del cliente

- [x] C1 `readDocument` en `src/lib/ai` (parte `file`, modelo de visión,
      defensa de origen) + tests.
- [x] C2 Plan: documento PDF → `process` (retiene el turno); tope de
      lectura 10 MB.
- [x] C3 `processInboundMedia`: guarda, lee, marca y suelta el turno.
- [x] C4 Marcador del agente para documentos leídos/pendientes/fallidos.
- [x] C5 Hilo: «Leyendo el documento…» / «Lo que dice» / no se pudo leer.
- [x] C6 ai-mock: parte `file` → resumen fijo; «ilegible» → sin contenido.

## Fase D — Verificación y entrega

- [x] D1 Gate (typecheck, lint, unit, build).
- [x] D2 Guion `tests/e2e/027-voice-notes-pdf.md` conducido con mocks.
- [x] D3 CLAUDE.md + memoria.
- [x] D4 Merge + deploy (autorizado) + `INSTAGRAM_HUMAN_AGENT` documentado.

## Estado

30-sep-2026: A–D3 hechas. Gate verde (typecheck, lint, 1.283 unit, build) y
guion `tests/e2e/027-voice-notes-pdf.md` conducido: nota de voz OGG/Opus real
por la UI (decodificada en el navegador) con `voice: true` a WhatsApp y WAV a
Instagram; PDF leído y usado por el agente; ilegible/Word/Instagram;
Instagram 24 h bloqueado sin «Human Agent».
D4: `16f8222` fast-forward a `main`; Railway 7fe3222a SUCCESS, health 200,
media-link sin firma 404, envío sin sesión 401, mocks 404.
