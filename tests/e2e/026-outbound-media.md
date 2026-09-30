# E2E 026 — Enviar imágenes, archivos y videos desde la Bandeja

Entorno: dev server del worktree en el puerto 3026 + mocks
(`WA_MOCK_ENABLED=true`, wa-mock, ig-mock y ai-mock apuntando a 3026),
usuario `e2e@vocero.test` (owner de «Negocio de Super Admin Local», org A,
WhatsApp mock `111111111` e Instagram mock conectado; MEMBER de
«Inmobiliaria Demo», org B, WhatsApp mock `222222222`). Migración 0022
aplicada. La UI se conduce en el Browser pane (escritorio 1366 px y móvil
375 px); los archivos se eligen inyectando un `File` real en
`[data-testid=media-file]` con `DataTransfer` (el selector nativo no se
puede conducir). Archivos reales: fixtures de la librería
`gabriel-vasile/mimetype` (jpg, png, webp, heic, pdf, docx, mp4, mov, mp3,
m4a, zip, svg) servidos temporalmente desde `public/e2e-026/` (se borran al
terminar). IA apagada en las conversaciones de prueba para que el agente no
intercale respuestas.

## Guion

### US1 — Enviar por WhatsApp (owner, org A)

1. `POST /api/dev/wa-mock/inbound` (Laura, `5493515550801`) → conversación
   con la ventana abierta. El clip «Adjuntar archivo»
   (`data-testid=media-attach`) aparece; su `accept` lista solo lo que manda
   WhatsApp (jpg/png/mp4/3gp/mp3/m4a/aac/ogg/amr/pdf/Office/txt/csv, sin
   WebP ni MOV).
2. **Imagen**: elegir `obra-frente.jpg` → tarjeta pendiente con miniatura:
   «Imagen · 10 KB · el texto va como epígrafe»; el placeholder cambia a
   «Agregá un comentario (opcional)…». Escribir el epígrafe y Enviar → la
   burbuja muestra la foto + «Así está quedando el frente de la obra» con
   el reloj. wa-mock: `mediaUploads[0]` = `image/jpeg`, `obra-frente.jpg`,
   10.121 B, cabecera `ffd8ffe0…` (el archivo real); `outbox` =
   `{type:"image", image:{id:<la subida>, caption}}`.
3. `POST /api/dev/wa-mock/status` `read` → el tick pasa a azul sin recargar.
4. **Documento**: «Presupuesto obra Laura — año 2026.pdf» + «Te paso el
   presupuesto» → tarjeta «PDF · 29 KB» + epígrafe; payload `document` con
   `filename` UTF-8. `GET` del binario: `application/pdf`, `inline;
   filename="…"; filename*=UTF-8''…%E2%80%94…a%C3%B1o…`, `nosniff`;
   `?download=1` → `attachment`.
5. **Video**: `recorrida.mp4` + epígrafe → `<video>` reproduce (duración
   5,57 s, `readyState 4`); `Range: bytes=0-1` → 206 `bytes 0-1/383631`.
6. **Audio**: `audio-explicacion.mp3` + texto → la tarjeta avisa «WhatsApp
   manda el texto como un mensaje aparte»; la burbuja es solo el
   reproductor (sin «Transcribiendo…»); outbox: `audio {id}` y DESPUÉS
   `text "Te dejo un audio explicando"`.
7. **Enter** (escritorio) con un `.m4a` pendiente lo envía.
8. **Pegar** (⌘V) una imagen en el campo → queda pendiente con miniatura;
   la X la descarta.

### US2 — Rechazos y fallos

1. **Navegador** (antes de subir): WebP → «WhatsApp no acepta imágenes
   WebP: mandala como JPG o PNG.»; HEIC → ídem; `.MOV` → «WhatsApp solo
   acepta videos MP4 o 3GP…»; `.zip` → lista de lo que sí se puede; JPG de
   6 MB → «La imagen supera el máximo de 5 MB de WhatsApp.». Ninguno queda
   pendiente.
2. **Servidor** (saltando el navegador con `fetch`): SVG renombrado a
   `.jpg` → 415; HTML renombrado a `.pdf` → 415; JPG de 6 MB → 413; PDF de
   26 MB → 413 por `Content-Length` (sin leer el cuerpo); vacío → 422;
   JSON → 422 `invalid`.
3. **Meta rechaza la subida** (knob `mediaUploadFails`): `Contrato de
   obra.docx` → burbuja «No entregado: WhatsApp no pudo procesar el
   archivo (formato, códec o tamaño…)» + **Reintentar**; el composer suelta
   el adjunto y dice que el motivo está en el mensaje. Reintentar → la
   línea desaparece, reloj, y el outbox recibe el `document` con
   `filename` y epígrafe.
4. **Meta caída** (knob `failNextSend`): `plano.png` → 503
   `meta_unavailable` con `messageId`; reintento → 200. Reintentar un
   mensaje no fallido → 422; un id ajeno → 422.
5. **Fallo asincrónico**: `status failed` con «Media upload error» sobre el
   video ya enviado → la burbuja muestra el motivo traducido y Reintentar
   **sin recargar** (el SSE `message.status` lleva `error`).
6. **Guardas**: ventana cerrada (Fernando, 24-sep) → 409 `window_closed` y
   en la UI no hay clip (modo plantilla); Laboratorio (`is_test`) → 403
   `sandbox_violation`; Entrenador → 409 `not_channel`; conversación de
   otra empresa → 404.
7. **Binarios**: `/api/message-media/<id de org A>` desde org B → 404 (con
   `cache: no-store`); `/api/media-link/<id>` sin firma o con firma falsa →
   404.

### Miembro (org B)

`POST /api/workspaces/switch` a Inmobiliaria Demo (rol `member`) → un PDF
a una conversación con la ventana abierta → 201.

### US3 — Instagram Direct (owner, org A, `echoSends` encendido)

1. DM de Valentina (`ig-mock/inbound`) → clip con `accept` de Instagram.
2. `.docx` → «Instagram solo acepta documentos PDF.» (local).
3. Imagen + «Así es la cabaña 🌲», PDF y `.MOV` → ig-mock `outbox`: tres
   adjuntos `image`/`file`/`video` cuya URL es `/api/media-link/mm_…` con
   firma; el mock la BAJÓ (200, `image/jpeg` 10.121 B `ffd8ffe0…`,
   `application/pdf` 29.955 B, `video/quicktime` 179.789 B) y el epígrafe
   salió como un texto aparte. En la BD: una fila por envío, todas
   `source=cloud` — los ecos no duplicaron nada.
4. Instagram caído (`failNextSend: "down"`) → 503 «Instagram no está
   disponible ahora», burbuja fallida con Reintentar → entregado.

### US4 — Videos y documentos del cliente

1. WhatsApp: documento con `filename` «Planos completos.pdf» + «Los
   planos» → `media_state=ready`, tarjeta con el nombre original, «PDF ·
   193 B» y el epígrafe debajo.
2. WhatsApp: video + «Mirá cómo quedó la pared» → `ready`, `video/mp4`,
   reproductor con el epígrafe.
3. Knob `mediaTooLarge` → documento «Comprobante transferencia.pdf» queda
   `failed`: «Documento — Comprobante transferencia.pdf / El archivo es más
   grande de lo que aceptamos: abrilo desde el celular.».
4. Instagram: `attachment: file` → `document` guardado como `archivo.pdf`
   (`application/pdf`).

### Móvil (375 px)

Tarjeta pendiente con nombre largo recortado, sin scroll horizontal
(`scrollWidth = 375`); al abrir un hilo con imágenes y videos queda al
final aun después de que cargan (distancia al fondo 0, sin botón «↓»).

## Resultado (30-sep-2026)

Verde. Hallazgos corregidos durante la conducción: concordancia «El
imagen» → «La imagen»; el nombre del documento se cortaba en una línea
(ahora dos); el composer repetía el motivo largo que ya muestra la burbuja;
el Entrenador respondía «Laboratorio» en vez de su propio motivo; el hilo
no seguía al final cuando una burbuja crecía o un medio terminaba de
cargar.
