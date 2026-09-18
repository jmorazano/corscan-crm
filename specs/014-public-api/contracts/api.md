# Contrato — API pública v1 (014)

Autenticación: `Authorization: Bearer vk_…`. Errores:
`{ "error": { "code": string, "message": string, ...extra } }`.

## Comunes

| HTTP | code | Cuándo |
|---|---|---|
| 401 | `invalid_api_key` | sin header, clave inexistente o revocada |
| 429 | `rate_limited` | > 60 llamadas/min con la clave (`retryInSeconds`) |
| 500 | `internal` | no controlado (sin stack) |

## `GET /api/v1/templates[?status=all]`

Por defecto solo `approved`. Respuesta:

```json
{
  "templates": [{
    "id": "tpl_…", "name": "recordatorio_checkin", "language": "es",
    "category": "UTILITY", "status": "approved",
    "body": "Hola {{1}}, te esperamos en {{2}} el {{3}}.",
    "header_image": false,
    "variables": [
      { "index": 1, "origin": "contact_name", "provided_by": "crm", "label": "Nombre del contacto", "sample": "María" },
      { "index": 2, "origin": "free_text", "provided_by": "caller", "label": "Texto libre al enviar", "sample": "una promo especial" },
      { "index": 3, "origin": "free_text", "provided_by": "caller", "label": "Texto libre al enviar", "sample": "una promo especial" }
    ],
    "example": { "to": "+54 9 351 123 4567", "name": "Nombre del cliente", "template": "recordatorio_checkin", "params": { "2": "…", "3": "…" } }
  }]
}
```

Plantilla legada (sin orígenes) con `{{1}}`: una variable `free_text` de
índice 1 (`provided_by: caller`).

## `POST /api/v1/messages`

Headers: `Content-Type: application/json`, `Idempotency-Key` (opcional,
≤ 200 chars, recomendado).

Body:

```json
{
  "to": "+54 9 351 688 2234",
  "name": "Juan Pérez",
  "template": "recordatorio_checkin",
  "language": "es",
  "params": { "2": "Cabaña Los Pinos", "3": "viernes 25/10 a las 14:00" }
}
```

- `to`: obligatorio; dígitos con código de país (se normaliza a wa_id).
- `name`: opcional (≤ 120); solo se usa si el contacto es nuevo o su
  nombre es el placeholder.
- `template`: nombre exacto; `language` obligatorio solo si el nombre
  existe en más de un idioma.
- `params`: objeto índice (string) → valor; exactamente los índices
  `provided_by: caller`. Valores: 1–500 chars, sin `\n`, `\t` ni 4+ espacios
  seguidos.

201:

```json
{
  "message": { "id": "msg_…", "status": "pending", "template": "recordatorio_checkin" },
  "contact": { "id": "ct_…", "phone": "5493516882234", "created": true },
  "conversation": { "id": "cv_…", "url": "https://…/inbox?c=cv_…" }
}
```

Replay idempotente: mismo cuerpo 201 + header `Idempotent-Replayed: true`.

| HTTP | code | Cuándo |
|---|---|---|
| 422 | `invalid_body` | JSON inválido / campos con formato inválido |
| 422 | `invalid_phone` | teléfono no normalizable |
| 404 | `template_not_found` | nombre (+idioma) inexistente |
| 422 | `language_required` | nombre en varios idiomas sin `language` (`languages: [...]`) |
| 422 | `template_not_approved` | estado ≠ approved (`status`) |
| 422 | `missing_params` | faltan índices (`missing: ["2"]`) |
| 422 | `unknown_params` | índices que el CRM completa o inexistentes (`unknown: ["1"]`) |
| 422 | `invalid_param` | valor vacío/largo/con saltos (`index`) |
| 422 | `idempotency_mismatch` | misma clave, cuerpo distinto |
| 409 | `idempotency_in_progress` | misma clave en curso |
| 409 | `opted_out` | contacto dado de baja y ventana cerrada |
| 409 | `sandbox_contact` | el teléfono pertenece a un contacto del Laboratorio |
| 409 | `not_connected` / `reconnect_required` | canal no operativo |
| 429 | `quota_exceeded` | cupo 24h agotado (`retryInSeconds`) |
| 422 | `meta_error` | Meta rechazó el envío (mensaje de Meta) |
| 503 | `meta_unavailable` | Meta caída; reintentar con la misma `Idempotency-Key` |

## `GET /api/v1/messages/{id}`

200:

```json
{
  "message": {
    "id": "msg_…", "status": "delivered", "error": null, "error_raw": null,
    "template": "recordatorio_checkin", "to": "5493516882234",
    "conversation_id": "cv_…", "created_at": "2026-09-18T12:00:00.000Z"
  }
}
```

404 `not_found` si no existe o es de otra empresa.

## API interna (sesión) — Ajustes → API

- `GET /api/settings/api-keys` → `{ keys: [{ id, name, prefix, createdAt, lastUsedAt, revokedAt }], canManage }`
- `POST /api/settings/api-keys` `{ name }` (owner) → 201 `{ key: {…}, secret: "vk_…" }` (única vez)
- `DELETE /api/settings/api-keys/{id}` (owner) → `{ ok: true }` (idempotente)

## DTO de mensaje (bandeja)

`MessageDto.via: { kind: "api"; label: string } | null` — «Enviado por
API · <label>».
