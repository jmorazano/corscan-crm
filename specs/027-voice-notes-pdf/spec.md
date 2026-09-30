# Feature Specification: Notas de voz para clientes y el agente lee PDFs

**Feature Branch**: `027-voice-notes-pdf`

**Created**: 2026-09-30

**Status**: Draft

**Input**: Pedido del dueño (30-sep-2026), después de 026: «agregá también
grabar notas de voz para clientes y que el agente lea pdfs». Y un reporte:
«en una conversación de IG en la ventana de 7 días no pude enviarle una
imagen al usuario, sospecho que ese tipo de mensaje no se marcó como human
agent».

Extiende 015 (grabador), 020 (adjuntos entrantes), 022 (modelo de visión),
023 (Instagram) y 026 (adjuntos salientes). Sin cambios de constitución ni
dependencias nuevas: la codificación Opus usa WebCodecs del navegador y el
contenedor Ogg se arma con código propio; el PDF lo lee el mismo proveedor
OpenRouter de la empresa.

## Diagnóstico del reporte de Instagram (30-sep-2026)

La fila en producción (`msg_kmoljww3ugtsp3qb491n`, imagen, 15:21 UTC) salió
CON la etiqueta `HUMAN_AGENT` y Meta la rechazó: «To use 'Human Agent', your
use of this endpoint must be reviewed and approved by Facebook». El App
Review (MCP de Meta, app 2262662764507422) muestra «Human Agent» sin
aprobar y la solicitud 2319227285517636 sin enviar. No es un error del
código: entre las 24 h y los 7 días Instagram NO deja responder hasta que
Meta apruebe el permiso — ni imágenes ni texto.

Arreglo: el CRM deja de ofrecer algo que siempre falla. Flag de instancia
`INSTAGRAM_HUMAN_AGENT` (apagado por defecto): apagado, Instagram cierra a
las 24 h con un aviso que explica por qué; encendido (cuando Meta apruebe),
vuelve la ventana de 7 días. El rechazo de Meta, si igual llega, se muestra
en castellano.

## Decisiones tomadas (defaults sensatos, revisables)

- **Nota de voz de WhatsApp = OGG/Opus mono con `voice: true`**: es lo único
  que WhatsApp muestra como nota de voz (foto del negocio, micrófono,
  transcripción del lado del cliente). 16 kb/s: 3 minutos ≈ 360 KB, debajo
  de los 512 KB con los que WhatsApp muestra el ▶ en vez de «descargar».
- **Se codifica en el navegador** (WebCodecs `AudioEncoder`: Chrome, Edge,
  Firefox 130+, Safari 26+) a partir del mismo PCM que ya graba el
  Entrenador. Sin WebCodecs: `MediaRecorder` en `audio/mp4` (llega como
  audio común, sin burbuja de voz); sin ninguno, el micrófono lo dice.
- **Instagram**: WAV (Instagram acepta WAV/M4A/AAC, no OGG).
- **Se manda al soltar**, como en WhatsApp: tap para grabar, tap para
  enviar, X para descartar. Tope de 3 minutos (el del Entrenador).
- **La nota de voz del equipo se transcribe** en segundo plano si la
  empresa tiene IA: se ve debajo del reproductor y entra al historial del
  agente (para que no contradiga lo que dijo una persona). Sin IA, solo el
  reproductor.
- **El agente lee los PDF del cliente** con el modelo de visión de la
  empresa (lectura nativa de Gemini por defecto; sirve también para PDFs
  escaneados): un resumen de 1 a 4 oraciones con el tipo de documento y lo
  que pide o informa, con la MISMA defensa de origen que las imágenes (nunca
  CBU, alias, cuentas, tarjetas, importes, DNI ni titulares).
- **Hasta 10 MB se leen**; hasta 25 MB se guardan para el equipo; más, se
  avisa. Word, Excel y demás se siguen guardando sin leer.
- **El turno espera la lectura** (como con las imágenes, 020 D5): si no, el
  agente contestaría sin saber qué mandó el cliente. Fallida o no, el turno
  sale igual.

## User Scenarios & Testing

### US1 — Nota de voz a un cliente (P1)

Con la ventana abierta y el campo vacío aparece el micrófono. Tap → graba
(cronómetro, X para descartar); tap en enviar → la nota aparece en el hilo
con reproductor y duración, y un rato después su transcripción. En
WhatsApp llega como nota de voz (`audio {id, voice: true}`, OGG/Opus).

**Acceptance**: 1) micrófono en WhatsApp e Instagram con la ventana
abierta, nunca con la ventana cerrada; 2) WhatsApp recibe `audio/ogg`
(Opus) con `voice: true`; Instagram recibe un WAV por URL firmada; 3) el
OGG es válido (el navegador lo decodifica con la duración grabada);
4) permiso de micrófono denegado o navegador sin soporte → mensaje claro,
nada se envía; 5) sin IA configurada, la nota se envía igual (sin
transcripción).

### US2 — El agente lee los PDF del cliente (P1)

Un cliente manda un PDF (requisitos, comprobante, plano). El hilo muestra
la tarjeta con «Leyendo el documento…» y después «Lo que dice: …»; el
agente responde sabiendo qué es.

**Acceptance**: 1) el turno espera la lectura y la usa (`[ADJUNTO] El
cliente mandó un documento PDF («nombre»): <resumen>`); 2) lectura fallida,
PDF > 10 MB, o IA apagada → el turno sale igual con «no lo pude leer»;
3) el resumen nunca trae datos sensibles (prompt); 4) Word/Excel siguen
sin leerse.

### US3 — Instagram después de 24 h (P1)

**Acceptance**: 1) con `INSTAGRAM_HUMAN_AGENT` apagado, pasadas las 24 h
el composer muestra el aviso (ventana de 24 h + permiso de Meta pendiente)
y el servidor responde `window_closed` sin llamar a Meta; 2) encendido,
vuelve el modo de 7 días con HUMAN_AGENT; 3) el rechazo «Human Agent» de
Meta se traduce.

## Fuera de alcance

- Pausar/retomar una grabación; forma de onda.
- Leer Word/Excel del cliente; que el Entrenador acepte PDFs.
- Mandar el App Review de «Human Agent» (lo envía el dueño desde el panel).
