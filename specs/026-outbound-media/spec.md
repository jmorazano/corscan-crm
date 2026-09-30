# Feature Specification: Enviar imágenes, archivos y videos desde la Bandeja

**Feature Branch**: `026-outbound-media`

**Created**: 2026-09-30

**Status**: Draft

**Input**: Pedido del dueño (30-sep-2026): «Tenemos que agregar la
posibilidad de que el usuario del CRM pueda enviar (y mostrarse en el
thread) imágenes, archivos y videos».

Extiende 001 (envío de texto), 015/022 (adjuntos del Entrenador), 020
(adjuntos entrantes) y 023 (Instagram Direct). Hoy la Bandeja solo envía
texto y plantillas; los adjuntos existen únicamente en el Entrenador y en lo
que manda el cliente (audio e imagen). 020 dejó explícitamente fuera de
alcance «enviar audio o imágenes DESDE el CRM»: esta feature lo cubre.

Sin cambios de constitución: el envío va por la misma Cloud API de WhatsApp
(categoría 1) y por Instagram Direct (023, mismo proveedor); los binarios
viven en Postgres propio (`message_media`, ningún S3).

## Decisiones del dueño (30-sep-2026)

- **Lo entrante también se ve**: los videos y documentos que MANDA el
  cliente (un comprobante en PDF, un video) se descargan y se muestran en el
  hilo con el mismo visor. El agente NO los lee: sigue viendo «el cliente
  mandó un documento».
- **Tope de documentos: 25 MB** (enviados y recibidos). Imagen y video usan
  los límites de cada canal (WhatsApp: imagen 5 MB, video 16 MB).
- **Merge + deploy autorizados** al quedar verde el gate y el self-test.

## Decisiones tomadas (defaults sensatos, revisables)

- **Quién envía**: cualquier miembro que hoy puede enviar texto (owner y
  member). Enviar es operar, no configurar.
- **Previsualizar antes de enviar**: en una conversación con un cliente el
  archivo NO sale al elegirlo (a diferencia del Entrenador): queda como
  adjunto pendiente arriba del campo, con miniatura o nombre y tamaño, y el
  texto del campo viaja como epígrafe. Se envía con el botón o Enter; la X
  lo descarta. Evita mandarle a un cliente un archivo equivocado.
- **Cuatro familias**: imagen, video, documento y audio (un .mp3/.m4a que
  el equipo adjunta se manda como audio reproducible). Grabar notas de voz
  para clientes queda fuera (WhatsApp exige OGG/Opus para la burbuja de voz).
- **La firma binaria manda**: el tipo se decide por los bytes (y la
  extensión para distinguir Office), nunca por el MIME que declara el
  navegador. Lo que el canal no acepta se rechaza con un motivo claro antes
  de subirlo.
- **Tipos por canal** (documentación de Meta, 30-sep-2026):
  - WhatsApp: imagen JPEG/PNG ≤5 MB; video MP4/3GPP ≤16 MB; audio
    AAC/AMR/MP3/M4A/OGG ≤16 MB; documento PDF, Word, Excel, PowerPoint,
    TXT/CSV ≤25 MB (tope nuestro; Meta acepta 100 MB).
  - Instagram: imagen JPEG/PNG ≤8 MB; video MP4/MOV/WebM ≤25 MB; audio
    AAC/M4A/WAV ≤25 MB; documento SOLO PDF ≤25 MB. Instagram no acepta
    texto junto con el adjunto: el epígrafe sale como un mensaje aparte.
- **Ventana**: el adjunto es mensaje libre: WhatsApp exige la ventana de 24
  h abierta (cerrada → solo plantillas, como hoy); Instagram, 24 h o 7 días
  con HUMAN_AGENT (lo manda una persona).
- **Primero se guarda, después se envía**: el mensaje aparece al instante en
  el hilo con el reloj de «pendiente»; si Meta lo rechaza queda como «No
  entregado: motivo» con un botón **Reintentar** (reenvía el mismo binario;
  no hace falta volver a elegir el archivo).
- **WhatsApp por subida, Instagram por enlace**: a WhatsApp se le sube el
  binario (`POST /{phone-number-id}/media`, recomendado por Meta, el error
  llega sincrónico). Instagram solo acepta una URL pública: se genera un
  enlace FIRMADO y con vencimiento (24 h) a ese único archivo.
- **El agente se entera**: un adjunto que mandó el equipo entra al
  historial del agente como `[ADJUNTO] Le mandaste al cliente un documento`
  (+ el epígrafe), para que no repita lo que ya se envió.
- **Servir archivos sin riesgo**: el visor sirve inline solo tipos seguros
  (imagen, video, audio, PDF, texto) con `nosniff`; el resto se descarga
  como adjunto y lo desconocido va como `application/octet-stream` (un
  HTML o SVG que mande un cliente jamás se ejecuta en el dominio del CRM).

## User Scenarios & Testing

### US1 — Enviar una imagen, un video o un documento por WhatsApp (P1)

Un operador está en una conversación de WhatsApp con la ventana abierta,
toca el clip, elige un PDF (o una foto, o un video), escribe «Te paso el
presupuesto» y envía. El mensaje aparece en el hilo con el archivo y el
texto; los ticks avanzan con los estados de Meta.

**Acceptance**:
1. El clip está visible en escritorio y en móvil en conversaciones de
   WhatsApp e Instagram con la ventana abierta; no aparece con la ventana
   cerrada (modo plantilla) ni en el Laboratorio.
2. Elegir, arrastrar o pegar (⌘V) un archivo lo deja pendiente con
   miniatura (imagen) o nombre y tamaño; la X lo descarta; Enter o el botón
   lo envían con el texto del campo como epígrafe.
3. Durante la subida se ve «Enviando archivo… N%».
4. En el hilo: la imagen con miniatura ampliable, el video con reproductor,
   el documento como tarjeta con nombre, tipo y tamaño que se abre en otra
   pestaña y tiene «Descargar»; el audio con reproductor (sin bloque de
   transcripción).
5. A Meta le llega el tipo correcto (`image`/`video`/`document`/`audio`)
   con el id de la subida, el epígrafe y, en documentos, el nombre.

### US2 — Rechazos y fallos claros (P1)

**Acceptance**:
1. Un tipo que el canal no acepta (WebP o HEIC a WhatsApp, un .zip, un
   .docx a Instagram) se rechaza en el navegador con el motivo y lo que sí
   se puede mandar; el servidor revalida por firma binaria (415).
2. Un archivo más grande que el tope se rechaza (413) sin subirse entero.
3. Meta rechaza la subida o no responde → el mensaje queda «No entregado:
   motivo en castellano» con **Reintentar**; reintentar con Meta de vuelta
   lo entrega sin duplicar el mensaje.
4. Ventana cerrada, número desconectado o token vencido → error claro y no
   se guarda nada.
5. El Laboratorio (`is_test`) y el Entrenador jamás llegan a Meta por esta
   ruta (403/409).

### US3 — Instagram Direct (P2)

**Acceptance**:
1. Imagen, video, audio o PDF salen como adjunto por URL firmada; Instagram
   la puede bajar; un enlace vencido o adulterado da 404.
2. El epígrafe sale como un mensaje de texto aparte, registrado una sola vez
   (el eco de Instagram no duplica ni el adjunto ni el texto).

### US4 — Ver los videos y documentos que manda el cliente (P2)

**Acceptance**:
1. Un video o documento entrante de WhatsApp o Instagram se descarga en
   segundo plano y se ve con el mismo visor (el documento con su nombre
   original).
2. Mientras baja: «Descargando…»; si supera el tope o falla: el tipo, el
   nombre y el motivo («Muy grande para guardarlo en el CRM: abrilo en el
   celular»).
3. El agente responde sin esperar la descarga y sigue viendo solo que el
   cliente mandó un documento o un video.

## Requirements

- **FR-001** `POST /api/conversations/{id}/messages/media` (multipart
  `file` + `caption` opcional), `withAuth`. 201 `{ messageId, captionError }`.
- **FR-002** Validación pura y compartida (`src/lib/outbound-media.ts`):
  clasificación por firma binaria, matriz de tipos y topes por canal,
  nombre de archivo saneado, epígrafe ≤1.024.
- **FR-003** Orden de guardas igual al texto: sandbox → trainer → ventana →
  credenciales; recién entonces se guarda el mensaje (`pending`,
  `media_state='ready'`) con su binario y se publica `message.new`.
- **FR-004** WhatsApp: subida multipart por `graphRequest` (única frontera
  con Meta) + envío por id; Instagram: adjunto por URL firmada
  (`/api/media-link/{id}`, HMAC con secreto derivado, 24 h).
- **FR-005** Fallo del proveedor tras guardar → `status='failed'` + `error`
  y `message.updated`; la respuesta trae el `messageId` para que el
  composer suelte el adjunto. `POST …/messages/{messageId}/retry` reenvía
  un adjunto fallido del canal (reemplaza el `wa_message_id`).
- **FR-006** `message_media.file_name` (migración 0022) y `MessageMediaDto`
  con `fileName` y `sizeBytes`.
- **FR-007** `/api/message-media/{id}`: inline solo tipos seguros,
  `nosniff`, `?download=1` → `attachment` con nombre (RFC 5987).
- **FR-008** Entrantes: `planInboundMedia` agrega el plan `store` (video
  16 MB, documento 25 MB): descarga y guarda sin IA ni retener el turno.
- **FR-009** Historial del agente: los adjuntos salientes entran con
  `[ADJUNTO] Le mandaste al cliente …` + epígrafe.
- **FR-010** El SSE `message.status` lleva `error` (el motivo de un fallo
  asincrónico se ve sin recargar) y `friendlyDeliveryError` traduce el
  131053 (Meta no pudo procesar el archivo).
- **FR-011** Mocks: wa-mock `POST {pn}/media` + validación del id en
  `/messages` + knob `mediaUploadFails`; binarios de video y documento para
  entrantes; ig-mock acepta `message.attachment`, BAJA la URL como
  Instagram y registra el resultado.

## Fuera de alcance

- Grabar notas de voz para clientes desde el composer.
- Varios archivos en un solo envío (se manda de a uno).
- Adjuntos desde la API pública (`/api/v1`) y en campañas.
- Que el agente de IA mande archivos por su cuenta.
- Que el agente lea videos o documentos (PDF) del cliente.
- Descargar los adjuntos del historial importado del celular (017) y de los
  ecos «Desde el celular».
