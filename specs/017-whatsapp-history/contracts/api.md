# Contratos — 017 Historial del celular

## Meta (coexistence)

- `POST /{phone_number_id}/smb_app_data` con `{messaging_product:
  "whatsapp", sync_type: "smb_app_state_sync" | "history"}` →
  `{messaging_product, request_id}`. Sin parámetro de período; dentro de
  las 24 h del onboarding.
- Webhook `history`: `value.history[] = {metadata:{phase 0|1|2,
  chunk_order, progress 0..100}, threads:[{id:<wa_id>, messages:[{from,
  to?, id, timestamp, type, <type>:{…}, history_context:{status}}]}]}` o
  `value.history[] = [{errors:[{code 2593109,…}]}]` (rechazado). Detalle
  de media: mismo `field`, `value.messages[]` con `id` del placeholder.
- Webhook `smb_message_echoes`: `value.message_echoes[] = {from, to, id,
  timestamp, type, <type>:{…}}`.
- Webhook `smb_app_state_sync`: `value.state_sync[] = {type:"contact",
  contact:{full_name, first_name, phone_number}, action, metadata}`.

## Interno

### `GET /api/settings/whatsapp/history-import`

```json
{ "import": { "status": "idle|requested|receiving|done|failed|declined",
  "days": 60, "progress": 55, "importedMessages": 120, "skippedOld": 30,
  "threads": 8, "requestedAt": "…", "finishedAt": null,
  "lastErrorCode": null, "lastError": null } | null,
  "connected": true }
```

### `POST /api/settings/whatsapp/history-import` (owner)

Body `{ days?: 1..180 }` (default 60). Pide contactos + historial a Meta.
→ `200 { import }`. Errores: `409 not_connected`, `409 in_progress`
(ya recibiendo), `422 meta_error` con el mensaje redactado de Meta
(p. ej. fuera de la ventana de 24 h), `503 meta_unavailable`.

### wa-mock

- `POST {pn}/smb_app_data` (graph mock): registra la solicitud y, para
  `history`, entrega en segundo plano dos webhooks `history` (chunk 2
  antes que chunk 1, progreso 50 y 100) + un detalle de media; para
  `smb_app_state_sync`, un webhook con nombres de agenda. Knob
  `historyDeclined: true` → webhook con el error 2593109.
- `POST /api/dev/wa-mock/echo` `{phoneNumberId, to, text, waMessageId?}` →
  entrega un `smb_message_echoes`.
- `GET /api/dev/wa-mock/outbox` incluye `syncRequests`.

### `MessageDto`

`+ source: "cloud" | "history" | "phone"`.
