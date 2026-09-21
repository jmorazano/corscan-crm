# E2E 015 — Notas de voz para el entrenador

Entorno: el de `015-agent-trainer.md`. El ai-mock devuelve una
transcripción fija ante cualquier `input_audio` (texto plano) y el sentinel
`[SIN_CONTENIDO]` si el `format` es `flac`. Limitación del Browser pane: no
hay micrófono ni `setInputFiles`; el archivo se inyecta en el `<input
type=file data-testid="audio-file">` del composer con `DataTransfer` desde
`javascript_tool` (mismo camino que un usuario adjuntando un archivo). El
WAV de prueba es `tests/e2e/fixtures/nota-de-voz.wav` (1 s, 440 Hz, 16 kHz
PCM16; generador `generate-audio.mjs`), reconstruido en la página con el
mismo algoritmo.

## Guion

1. **Ajustes → IA**: `GET /api/settings/ai` devuelve
   `defaults.transcriptionModel = google/gemini-2.5-flash` y el campo
   «Modelo de transcripción de notas de voz (opcional)» en la tarjeta; el
   PUT lo persiste (unit `ai-settings-route`).
2. **Composer del entrenador**: con el campo vacío el botón de enviar es un
   micrófono (`composer-mic`); en escritorio hay clip «Adjuntar audio»
   (`audio-attach`, oculto en móvil); input de archivo oculto presente.
3. **Adjuntar WAV**: inyectar el WAV → 201 `{messageId, mediaUrl}`;
   burbuja `audio-message` a la derecha con `<audio controls
   src=/api/message-media/mm_…>` y «Transcribiendo…» (`status pending`);
   por SSE `message.updated` pasa a `delivered` con la transcripción
   «Cuando pregunten por precio de mensura decí que arranca en ciento
   cincuenta mil pesos»; «Ari está pensando…» → «Actualicé la respuesta
   sobre el precio.» y la P/R del precio queda con ese texto.
4. **Media privada con Range**: `GET mediaUrl` → 200 `audio/wav`,
   `Accept-Ranges: bytes`, `Cache-Control: private, max-age=31536000,
   immutable`; con `Range: bytes=0-1` → 206 `Content-Range: bytes
   0-1/32044`, `Content-Length: 2`; id inexistente → 404.
5. **Rechazos locales (UI, sin request)**: `x.txt` → «El archivo no es un
   audio válido (.m4a, .ogg, .wav, .mp3)»; 9 MB → «La nota de voz supera el
   máximo de 8 MB (unos 3 minutos)».
6. **Rechazos de la API**: txt → 415 `unsupported_media`; WebM (firma
   Matroska) → 415; 9 MB → 413 `too_large`; conversación de WhatsApp →
   409 `not_trainer`.
7. **Audio sin contenido**: FLAC → 201; la transcripción falla con «El
   audio no tiene contenido reconocible» (`status failed`, burbuja roja) y
   NO hay turno del agente.
8. **Móvil (375 px)**: micrófono en el slot de enviar, clip oculto, dos
   burbujas de audio, `scrollWidth 375`.

## Resultado (21-sep-2026)

Todo ✅ tal como está descrito arriba. Unit tests nuevos: `voice-note`
(5), `audio-record` (8), `http-range` (4), `ai-transcribe` (6),
`ai-mock-audio` (3) — 570 en total en verde.

Pendiente de verificación humana: la grabación real con micrófono
(MediaRecorder `audio/mp4` en iPhone/Safari, permiso, auto-stop a 3 min) y
la transcripción con el modelo real de OpenRouter — el Browser pane no
tiene micrófono. Probar en el iPhone del dueño con la app instalada.
