# E2E 027 — Notas de voz para clientes · el agente lee PDFs · Instagram 24 h

Entorno: el de 026 (worktree en el puerto 3026, wa-mock + ig-mock +
ai-mock, `AGENT_COALESCE_MS=2000`, `e2e@vocero.test` owner de org A con IA
configurada). `INSTAGRAM_HUMAN_AGENT` SIN definir (apagado, como producción
hoy). El Browser pane no tiene micrófono: `getUserMedia` se reemplaza en la
página por el `MediaStream` de un oscilador (`AudioContext` →
`createMediaStreamDestination`), y el grabador corre COMPLETO (AudioWorklet
→ PCM → WebCodecs Opus → OGG propio). Chrome del pane:
`AudioEncoder.isConfigSupported({codec:'opus',…})` → `supported: true`.

## Guion

### US3 — Instagram después de 24 h (reporte del dueño)

Diagnóstico previo en producción: la imagen fallida del 30-sep salió CON
`HUMAN_AGENT` y Meta respondió «To use 'Human Agent', your use of this
endpoint must be reviewed and approved by Facebook»; el MCP de Meta muestra
«Human Agent» sin aprobar (App Review 2319227285517636 sin enviar).

1. Conversación de Valentina con `last_inbound_at` = hace 30 h → el
   composer NO aparece; en su lugar `instagram-window-24h`: «Pasaron más de
   24 horas… Instagram solo deja responder hasta 7 días cuando Meta aprueba
   el permiso «Human Agent» de la app, y todavía está pendiente…».
2. `POST …/messages/media` y `POST …/messages` → 409 `window_closed` con el
   motivo «Human Agent»; el ig-mock no recibe nada.
3. Un DM nuevo reabre la ventana → vuelve el composer.

### US1 — Nota de voz

1. **WhatsApp** (Laura): con el campo vacío aparece «Grabar nota de voz»
   (title «Grabar una nota de voz para Laura Presupuesto»). Tap → barra
   «0:02 / 3:00 · Grabando»; «Detener y enviar» → burbuja con reproductor,
   **0:13** y la transcripción debajo (ai-mock).
2. wa-mock: subida `audio/ogg`, `nota-de-voz.ogg`, 27.651 B, cabecera
   `4f676753 0002…` (OggS + BOS); mensaje `audio {id, voice: true}`. BD:
   `duration_ms 13249`, `media_state ready`, `text` = transcripción.
3. El `.ogg` bajado de `/api/message-media` lo decodifica el navegador
   (`decodeAudioData`): **13,15 s, mono, 48 kHz, pico 0,32** (el tono del
   oscilador) → contenedor y paquetes Opus válidos; ~16 kb/s.
4. **Instagram** (Valentina, ventana abierta): la nota va en WAV → ig-mock:
   adjunto `audio` bajado por URL firmada (200, `audio/wav`, 246.828 B,
   `52494646…` RIFF), sin `HUMAN_AGENT` (ventana estándar). Burbuja con 0:07
   y transcripción.

### US2 — El agente lee PDFs

IA encendida en la conversación de Laura.

1. `wa-mock/inbound` documento `Requisitos alquiler.pdf` → tarjeta con
   «Lo que dice: una lista de requisitos para alquilar: pide recibo de
   sueldo, garantía y documentación…» y el agente responde **una vez**
   «Leí el documento que mandaste (una lista de requisitos para alquilar).
   ¿Querés que coordinemos una visita?» — el ai-mock arma esa frase con el
   resumen que recibió en el contexto: el turno esperó la lectura y la usó.
2. `escaneo-ilegible.pdf` (sentinel del ai-mock) → «No se pudo leer el
   documento: el agente le va a preguntar de qué se trata.» y el agente:
   «No pude abrir el documento. ¿Me contás de qué se trata?».
3. `Contrato firmado.docx` (MIME de Word) → se guarda sin leer; el agente
   responde el genérico «Recibí lo que me mandaste…».
4. Instagram: `attachment: file` → se lee (Instagram no manda MIME) y el
   agente responde por Instagram con el tipo de documento.

## Resultado (30-sep-2026)

Verde. Gate: typecheck, lint, 1.283 unit, build.
