# Plan — 026 Enviar imágenes, archivos y videos desde la Bandeja

## Contexto técnico

- El envío de texto (`src/server/inbox/send.ts`) manda primero y registra
  después; los adjuntos del Entrenador (`src/server/trainer/image.ts`)
  guardan el binario en `message_media` 1:1 con el mensaje.
- `graphRequest` es solo JSON; no existe la subida `/{pn}/media`.
- `sendInstagramText` solo manda texto; la Send API de Instagram acepta
  `message.attachment` con `payload.url` (o un `attachment_id`), sin texto.
- `planInboundMedia` (020) solo descarga audio e imagen; el resto se
  «reconoce» sin binario.
- El hilo (`message-thread.tsx`) tiene visor para audio e imagen; video y
  documento caen en «📎 Documento — nombre».

## Fronteras

| Pieza | Archivo |
|---|---|
| Reglas puras (firma binaria, tipos y topes por canal, nombre, marcador del agente, disposición HTTP) | `src/lib/outbound-media.ts` (nuevo) |
| Enlace firmado para Instagram | `src/lib/media-link.ts` (puro) + `src/app/api/media-link/[id]/route.ts` |
| Subida a WhatsApp | `uploadWhatsAppMedia` en `src/lib/meta/client.ts` (`graphRequest` acepta `form`) |
| Adjunto de Instagram | `sendInstagramAttachment` en `src/lib/instagram/client.ts` |
| Orquestación (guardas, guardar, enviar, reintentar) | `src/server/inbox/send-media.ts` (nuevo) |
| API | `…/messages/media/route.ts`, `…/messages/[messageId]/retry/route.ts` |
| Servir binarios | `src/app/api/message-media/[id]/route.ts` |
| Entrantes video/documento | `src/lib/inbound-media.ts` (plan `store`) + `src/server/inbox/media.ts` + `ingest.ts` |
| Agente | `src/server/ai/pipeline.ts` (salientes con marcador) |
| UI | `composer.tsx` (adjunto pendiente), `inbox-client.tsx` (XHR con progreso, reintentar, SSE error), `message-thread.tsx` (video, documento, audio saliente, reintentar) |
| Mocks | wa-mock graph (`/media`, validación), `wa-mock-media.ts`, knobs; ig-mock graph + state |

## Diseño

### D1 — Guardar primero

`sendMedia` corre las guardas SIN escribir nada (sandbox, trainer, ventana,
credenciales). Pasadas, una transacción inserta el `message`
(`direction=out`, `type`=familia, `text`=epígrafe cuando el canal lo
acepta, `status=pending`, `media_state=ready`) y su `message_media`
(`file_name`), y actualiza `last_message_at`. `message.new` sale con el DTO
del binario: el operador ve el archivo en el hilo mientras sube a Meta.

Después `deliverMedia(messageId)`:
- WhatsApp: `uploadWhatsAppMedia` → `callGraphSend` con
  `{type, [type]: {id, caption?, filename?}}` → guarda el `wa_message_id`.
- Instagram: `signMediaLink` → `sendInstagramAttachment` → guarda el `mid`
  y `status=sent`. Si el eco ya insertó una fila con ese `mid`, se borra
  el eco y se reasigna (misma idea que el texto de 023).

Un fallo → `status=failed` + `error` legible + `message.updated` y se
relanza `SendError` (la ruta responde el código de siempre MÁS el
`messageId`). Reintentar = `deliverMedia` otra vez sobre el mismo mensaje
tras re-chequear ventana y credenciales.

El epígrafe que el canal no acepta en el adjunto (Instagram; audio en
WhatsApp) se manda con `sendText` DESPUÉS del adjunto. Si ese texto falla,
el adjunto ya salió: se responde 201 con `captionError` y el composer
conserva el texto para reenviarlo.

### D2 — Clasificación

`classifyOutboundFile(bytes, fileName)`:
- JPEG/PNG/WebP/GIF/HEIC por firma (HEIC/WebP/GIF se reconocen para
  rechazarlos con un motivo útil en el canal que no los acepta).
- ISO-BMFF (`ftyp`): marca `qt  ` → `video/quicktime`, `3gp*` →
  `video/3gpp`, `M4A ` → `audio/mp4`, el resto → `video/mp4`. WebM (EBML) →
  `video/webm`. `RIFF…AVI ` → `video/x-msvideo`. `RIFF…WAVE` → `audio/wav`.
- Audio por `sniffAudioMime` (015).
- `%PDF-` → PDF. `PK\x03\x04` + extensión docx/xlsx/pptx → OOXML. OLE2 +
  doc/xls/ppt → Office clásico. `.txt`/`.csv` sin bytes NUL → `text/plain`.
- Todo lo demás → `unsupported`.

`checkChannelSupport(channel, kind, mime, size)` aplica la matriz del spec.
El navegador usa `guessOutboundKind(name, type)` (por extensión) para el
rechazo temprano y el `accept` del input; el servidor manda.

### D3 — Enlace firmado (Instagram)

`/api/media-link/{mediaId}?e=<exp ms>&s=<hmac>`; HMAC-SHA256 sobre
`mediaId.e` con `${BETTER_AUTH_SECRET}:media-link`, comparación en tiempo
constante, vencimiento 24 h. Sin sesión (lo baja Instagram). Solo se firma
desde `deliverMedia`, así que solo circulan enlaces a adjuntos salientes.

### D4 — Servir sin riesgo

`dispositionFor(mime, fileName, download)`: inline para
`image/{jpeg,png,webp,gif}`, `video/*` conocidos, `audio/*`,
`application/pdf`, `text/plain` (con `charset=utf-8`); Office con su MIME
pero `attachment`; cualquier otro → `application/octet-stream` +
`attachment`. Siempre `X-Content-Type-Options: nosniff`. Nombre con
`filename="ascii"; filename*=UTF-8''…`.

### D5 — Entrantes

Plan `store` para `video` (16 MB) y `document` (25 MB) con id/URL. La
ingesta los deja `media_state=pending`, lanza la descarga en segundo plano
y dispara el turno en el acto (el marcador del agente no depende del
binario). `processInboundMedia` con `store`: baja, clasifica el MIME (si no
se reconoce, guarda el declarado: el visor lo neutraliza), guarda con el
`filename` del webhook y cierra `ready`/`failed` SIN soltar otro turno.

### D6 — UI

- Composer (modo canal): `accept` por canal, adjunto pendiente
  (`data-testid="attachment-pending"`), barra con progreso, pegar/arrastrar.
  El Entrenador no cambia.
- Hilo: `VideoAttachment`, `DocumentAttachment`, `AudioNote` sin
  transcripción para salientes del canal, `ImageAttachment` con textos de
  «enviada», botón «Reintentar» en adjuntos fallidos del canal.
- `onMessageStatus` guarda también `error`.

## Migración

0022: `ALTER TABLE message_media ADD COLUMN file_name text;` (nullable, sin
backfill: los binarios existentes son audio e imagen).

## Verificación

- Unit: clasificación y matriz por canal, nombre saneado, disposición,
  enlace firmado, plan `store`, marcador saliente, 131053, subida multipart,
  payloads de envío.
- E2E con mocks (`tests/e2e/026-outbound-media.md`): imagen, video,
  documento y audio por WhatsApp con el wa-mock verificando la subida y el
  payload; rechazos (WebP, .zip, tope); `mediaUploadFails` y
  `failNextSend` → fallido → Reintentar; ventana cerrada; sandbox;
  Instagram con el ig-mock bajando la URL firmada + epígrafe aparte + eco;
  entrantes video y PDF; miembro envía; móvil.

## Riesgos

- Cuerpos grandes: la ruta corta por `Content-Length` antes de parsear el
  multipart. Next (sin middleware) no impone límite en route handlers.
- Carrera con el webhook de estados: igual que el texto, el `wa_message_id`
  se guarda apenas Meta responde; un `sent` que llegue antes se pierde y lo
  corrige el `delivered`.
- Migraciones en paralelo de otras sesiones: si otra rama numera 0022,
  se renumera al mergear.
