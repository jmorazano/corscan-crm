# Contratos de API — Plantillas con imagen de encabezado (008)

## `POST /api/templates` (modificado: multipart)

Autenticado (`withAuth`). `Content-Type: multipart/form-data`.

| Campo | Tipo | Reglas |
|---|---|---|
| `name` | text | igual que hoy (1–60, se normaliza) |
| `language` | text | igual que hoy |
| `category` | text | `UTILITY` \| `MARKETING` |
| `body` | text | igual que hoy (1–1024, variables `{{1}}`) |
| `headerImage` | File (opcional) | JPEG/PNG ≤5MB |

Respuestas: `201 {template}` (ahora con `headerImageUrl`); `422` imagen o
cuerpo inválidos (mensaje claro); `409` sin conexión / reconexión requerida;
`503` Meta caída — en 4xx/5xx NO queda plantilla ni imagen (D5).
El body JSON actual deja de aceptarse: el cliente del CRM es el único
consumidor y migra en la misma feature.

## `GET /api/templates` (extendido)

Cada plantilla suma `headerImageUrl: string | null` (ruta relativa
`/api/template-media/{id}`).

## `GET /api/template-media/{id}` (nuevo, PÚBLICO)

Sin auth (requisito del canal: Meta descarga la imagen al enviar). `id` no
adivinable (nanoid `tm_…`).

- `200`: binario con `Content-Type` real, `Content-Length` y
  `Cache-Control: public, max-age=31536000, immutable`.
- `404`: id inexistente (plantilla borrada incluida).

## Envío (interno, `sendTemplateCore`)

Payload a Graph cuando la plantilla tiene imagen:

```json
{
  "type": "template",
  "template": {
    "name": "…", "language": { "code": "…" },
    "components": [
      { "type": "header", "parameters": [{ "type": "image", "image": { "link": "{APP_BASE_URL}/api/template-media/{id}" } }] },
      { "type": "body", "parameters": [{ "type": "text", "text": "…" }] }
    ]
  }
}
```

`body` solo si la plantilla tiene `{{1}}` (igual que hoy); `header` solo si
hay imagen; sin imagen el payload es byte-a-byte el actual (FR-009).

## Alta en Meta (interno, `createTemplate`)

`POST {waba}/message_templates` suma, si hay imagen, el componente:

```json
{ "type": "HEADER", "format": "IMAGE", "example": { "header_handle": ["<h del upload resumable>"] } }
```

## wa-mock (entorno de pruebas, gate `dev-guard`)

- `POST /api/dev/wa-mock/graph/{app_id}/uploads` → `{ "id": "upload:mock-<n>" }`
- `POST /api/dev/wa-mock/graph/upload:mock-<n>` (body binario) → `{ "h": "MOCK_HANDLE:<n>" }`
- `POST …/message_templates` acepta `components` (guarda HEADER/example).
- El outbox del mock registra `template.components` de cada send para que el
  guion E2E verifique el header con el link público.
