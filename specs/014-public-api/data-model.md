# Data model — 014 API pública

## api_key

| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `ak_…` |
| organization_id | text NOT NULL FK organization cascade | tenant |
| name | text NOT NULL | «Sistema de reservas» |
| key_hash | text NOT NULL UNIQUE | SHA-256 hex de la clave completa |
| key_prefix | text NOT NULL | primeros 11 chars (`vk_xxxxxxxx`) para identificarla |
| created_by | text NULL | user id (auditoría; sin FK dura) |
| created_at | timestamp NOT NULL default now | |
| last_used_at | timestamp NULL | se actualiza ≤ 1 vez/min |
| revoked_at | timestamp NULL | soft delete: la fila queda para el JOIN del hilo |

Índice `api_key_org_idx (organization_id, created_at)`.

## api_request (idempotencia)

| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | `areq_…` |
| organization_id | text NOT NULL FK cascade | |
| api_key_id | text NOT NULL | clave que hizo el request |
| idempotency_key | text NOT NULL | ≤ 200 chars |
| request_hash | text NOT NULL | SHA-256 del JSON canónico del body |
| status_code | integer NOT NULL default 0 | 0 = en curso |
| response_body | jsonb NULL | respuesta a repetir |
| message_id | text NULL | mensaje creado |
| created_at | timestamp NOT NULL default now | |

UNIQUE `api_request_org_key_uq (organization_id, idempotency_key)`.

## message (extendida)

- `api_key_id text NULL` — sin FK. `NULL` = mensaje no originado por API.

## contact (tipo)

- `consent_source` admite `"api"` (columna text: solo cambia el tipo TS).

## Migración

`drizzle/0011_*.sql` generada con `pnpm db:generate`; se aplica al
arrancar (idempotente).
