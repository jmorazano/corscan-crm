# E2E 020 — El agente ve y escucha (adjuntos entrantes)

Entorno: `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
`OPENROUTER_BASE_URL` → ai-mock, `AGENT_COALESCE_MS=2000`. Empresa
«Negocio de Super Admin Local» (`phone_number_id` 111111111), agente «Ari»
encendido, IA configurada.

El entrante se inyecta con `POST /api/dev/wa-mock/inbound` pasando `type`
(`audio`, `image`, `document`…) y, opcionalmente, `text` (epígrafe) y
`mediaId`. El mock emite `mediamock_<tipo>_<n>`; el CRM lo canjea por un
handle en el mock de Graph y baja el binario de
`/api/dev/wa-mock/media/<id>` (JPEG 1×1 real / página OggS). Un `mediaId`
que contenga `empty` devuelve un archivo que el ai-mock declara ilegible
(FLAC / PNG), que es cómo se ejercita el camino infeliz sin tocar el
proveedor real.

Knobs: `mediaDownloadFails` (404 de la CDN, se auto-apaga),
`mediaTooLarge` (el handle declara 64 MB).

## Guion

1. **Nota de voz → el agente contesta lo que le dijeron.** Entrante `audio`
   → `message_media` con 64 B `audio/ogg`, `media_state` `pending` →
   `ready`, `text` = «Hola, quería saber si tenés algo disponible para
   cuatro personas el fin de semana que viene». El agente responde «¡Hola!
   ¿Para qué fechas lo estás buscando? Decime el día de entrada y el de
   salida.» — es decir, contesta la consulta, no el mensaje anterior.
2. **En vivo por SSE, sin recargar.** Con el hilo abierto se inyecta otro
   audio: la burbuja aparece a los **349 ms** con `data-status="pending"`
   («Transcribiendo…») y pasa a `ready` con la transcripción a los
   **768 ms**.
3. **Comprobante de pago.** Entrante `image` con epígrafe «te paso el
   comprobante» → JPEG de 160 B guardado, `media_summary` = «un
   comprobante de transferencia bancaria», epígrafe intacto en `text`. El
   agente responde «Recibí el comprobante, gracias. Una vez que
   verifiquemos que el pago ingresó, te enviamos la confirmación por
   correo.»
4. **La guarda de reservas de 016 sigue mandando.** Con el mock redactando
   «…te confirmamos la reserva», `stripBookingPromise` reemplazó la
   respuesta entera por la frase segura. Se corrigió el TEXTO DEL MOCK, no
   la guarda: el negocio no confirma nada hasta que el alojamiento verifica
   el pago. Unit `ai-mock-media` fija esa redacción para que el guion no
   dependa de un texto que la guarda vaya a pisar.
5. **Bandeja.** `[data-testid="image-message"]` con miniatura clickeable
   (`image-thumb` → diálogo a tamaño completo), epígrafe del cliente y
   `image-summary` con el resumen de la IA y el ícono de destello.
   `[data-testid="audio-message"]` con `<audio controls
   src=/api/message-media/mm_…>` y la transcripción debajo. Sin errores de
   consola.
6. **Audio ilegible** (`mediaId=mediamock_audio_empty_1`): `media_state`
   `failed`, error «No se pudo transcribir el audio», y el agente responde
   «Perdón, no pude escuchar el audio. ¿Me lo escribís así te ayudo?».
7. **Descarga fallida** (`mediaDownloadFails`): `failed` con «No se pudo
   descargar el archivo de WhatsApp»; el agente responde «No pude abrir la
   imagen. ¿Me contás de qué se trata?».
8. **Archivo enorme** (`mediaTooLarge`): `failed` con «El archivo es más
   grande de lo que aceptamos» — el corte ocurre con el `file_size` que
   declara Meta, ANTES de bajar el cuerpo.
9. **Documento**: `media_state` NULL (no se descarga), `text` =
   `contrato.pdf`, y el agente responde «Recibí lo que me mandaste. ¿Me
   contás de qué se trata así te ayudo?» en vez de quedar mudo.
10. **Regresión del entrenador (015).** El estado de la transcripción se
    mudó de `status` a `media_state`. Las tres notas de voz que ya existían
    en la BD local renderizan bien tras el backfill de la migración (dos
    `ready` con su transcripción, una `failed` con su motivo), y una nota
    de voz NUEVA inyectada por el `<input type=file>` del composer se
    transcribe y aplica el cambio como antes.

## Resultado (23-sep-2026)

Todo ✅ tal como está descrito arriba. Gate verde: typecheck, lint, build y
935 → 940 tests. Unit nuevos: `inbound-media` (16),
`meta-media-download` (9), `ai-describe-image` (6), `ai-mock-media` (5).

## Nota sobre la migración 0016

El migrador de Drizzle decide por el timestamp del journal, no por el hash
del archivo: una base que ya aplicó 0016 no vuelve a correrlo. Como esta
rama no salió a ningún entorno, el archivo (con el backfill) corre entero
en todos. En la base local, donde 0016 se había aplicado antes de agregar
el backfill, el `UPDATE` se corrió a mano.
