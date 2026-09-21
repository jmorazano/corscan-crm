# Contratos — 015 Entrenador del agente

Todas las rutas usan la sesión interna (`withAuth`), sin restricción de rol
salvo las de Ajustes → IA (owner, ya existentes).

## Bandeja

### `GET /api/conversations`

Respuesta: `ConversationPage & { trainer: ConversationDto | null }`.
`trainer` se resuelve solo sin `cursor` (crea la conversación si falta y
hay IA configurada); `null` si no hay IA, o si hay `q`/`tags`, o si
`filter=unread` y no tiene no leídos. `unreadMessages` suma sus no leídos;
`total`/`unreadTotal` no lo cuentan. `ConversationDto.kind`:
`"whatsapp" | "trainer"`.

### `POST /api/conversations/[id]/messages`

Body `{ text: string(1..4096) }`. Si la conversación es `trainer`: inserta
el mensaje del dueño y dispara el turno → `200 { messageId }`; `409
ai_not_configured` sin credenciales. Si no, comportamiento actual
(`sendText`).

### `DELETE /api/conversations/[id]` → `409 trainer_conversation`.
### `DELETE /api/contacts/[id]` → `409 trainer_contact`. `GET /api/contacts`
excluye el contacto sintético incluso con `archived=true`.

## Entrenador

### `GET /api/trainer/changes?limit=` (1..100, default 30)

```json
{ "changes": [ { "id": "chg_…", "op": "kb_add", "targetId": "kb_…",
  "summary": "Nueva P/R: ¿Cuál es el precio de mensura?", "before": null,
  "after": { "kind": "qa", "question": "…", "answer": "…" },
  "createdAt": "…", "revertedAt": null, "messageId": "msg_…" } ] }
```

### `POST /api/trainer/changes/[id]/revert`

→ `200 { change }` (con `revertedAt`). Errores: `404 not_found`, `409
already_reverted`, `409 target_conflict` (el objetivo ya no existe o el id
volvió a existir).

### `POST /api/trainer/clear`

Borra los mensajes del hilo del entrenador; conserva los cambios. →
`200 { ok: true, deleted: n }`; `404 not_found` si no hay conversación.

## Knowledge base / perfil (contratos existentes)

- `PATCH /api/kb/[id]`: nuevo `422 kind_mismatch` (content sobre `qa`,
  question/answer sobre `block`).
- `GET /api/kb`: cada entrada incluye `source`.
- `PUT/DELETE /api/settings/ai`: además publica `conversations.updated`
  (la fila del entrenador aparece/desaparece en vivo).

## Contrato del modelo (entrenador)

System prompt con marcador `[ENTRENADOR]`, perfil actual, conocimiento con
ids (`[kb_x] P: … / R: …`, `[kb_x] BLOQUE: …`) y aviso de tamaño. Historial:
`out → user`, `in → assistant`. Salida JSON:

```json
{ "action": "reply", "text": "…" }
{ "action": "apply", "reply": "…", "changes": [
  { "op": "kb_add", "kind": "qa", "question": "…", "answer": "…" },
  { "op": "kb_add", "kind": "block", "content": "…" },
  { "op": "kb_update", "id": "kb_…", "answer": "…" },
  { "op": "kb_delete", "id": "kb_…" },
  { "op": "profile_set", "field": "name|tone|instructions|escalationRules|greeting", "value": "…" },
  { "op": "profile_append", "field": "tone|instructions|escalationRules", "text": "…" } ] }
```

Máximo 10 cambios por turno; los inválidos se descartan y la respuesta
informa cuántos no pudo guardar.

## Notas de voz (US3)

### `POST /api/conversations/[id]/messages/audio`

`multipart/form-data`: `file` (audio), `durationMs` opcional. Solo
conversaciones `trainer`. → `201 { messageId, mediaUrl }` con el mensaje en
`status: "pending"`; la transcripción llega por SSE `message.updated`.
Errores: `409 not_trainer`, `409 ai_not_configured`, `413 too_large` (> 8
MB), `415 unsupported_media` (no es audio / webm), `422 invalid`.

### `GET /api/message-media/[id]`

Autenticado y por tenant. `200` con `Accept-Ranges: bytes` y
`Cache-Control: private, max-age=31536000, immutable`; `206` ante `Range`
(`Content-Range`), `416` si no satisfacible; `404` si no existe o es de
otra empresa.

### `GET/PUT /api/settings/ai`

`config.transcriptionModel` y `defaults.transcriptionModel`; PUT acepta
`transcriptionModel` (1..200).

### SSE

Nuevo evento `message.updated { conversationId, message }` (reemplazo in
situ por id en el cliente).

### `MessageDto`

`+ media: { url, mimeType, durationMs } | null`. Para `type = "audio"`:
`text` = transcripción, `status` = `pending | delivered | failed`, `error`
= motivo.
