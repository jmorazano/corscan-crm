# Data model — 005 Integraciones + Google Calendar

Toda tabla lleva `organization_id NOT NULL` + índice org-first (Constitución III).

## `calendar_integration` (una por empresa)

| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | prefijo `cint_` |
| organization_id | text FK org, cascade | UNIQUE (`calendar_integration_org_uq`) |
| provider | text enum `google` | extensible a otros proveedores |
| account_email | text | cuenta conectada (display) |
| calendar_id | text, default `primary` | calendario destino |
| calendar_name | text null | display |
| timezone | text, default `America/Argentina/Buenos_Aires` | IANA |
| refresh_token_cipher / _iv / _tag | text NOT NULL | AES-256-GCM |
| access_token_cipher / _iv / _tag | text null | caché cifrada |
| access_token_expires_at | timestamp null | renovar si < 60 s |
| status | enum `connected` / `reconnect_required` | D9 |
| agent_booking_enabled | boolean default true | FR-007 |
| slot_minutes | integer default 30 | 5..480 |
| buffer_minutes | integer default 0 | 0..240 |
| min_lead_hours | integer default 2 | 0..168 |
| horizon_days | integer default 14 | 1..90 |
| weekly_hours | jsonb | `{ "1": [["09:00","13:00"],["15:00","18:00"]], … }` claves 0..6 (0=domingo); default lun–vie 09:00–18:00 |
| booking_instructions | text null | reglas libres para el agente |
| connected_by | text null | user id |
| created_at / updated_at | timestamp | |

## `appointment`

| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | prefijo `apt_` |
| organization_id | text FK org, cascade | |
| contact_id | text FK contact, cascade | |
| conversation_id | text FK conversation, set null | |
| google_event_id | text null | null en sandbox / si el proveedor no lo devolvió |
| calendar_id | text | calendario donde se creó |
| starts_at / ends_at | timestamp NOT NULL | UTC |
| timezone | text | zona en que se ofreció |
| title | text | "Turno: {contacto}" |
| note | text null | motivo dado por el cliente |
| status | enum `confirmed` / `cancelled` | monotónico |
| created_by | enum `agent` / `user` | |
| cancelled_at | timestamp null | |
| created_at | timestamp | |

Índices: UNIQUE (`organization_id`, `contact_id`, `starts_at`) → idempotencia
(FR-012); `appointment_org_starts_idx` (organization_id, starts_at).

## Validaciones (Zod, `src/server/calendar/rules.ts`)

- `weekly_hours`: objeto con claves "0".."6"; cada valor lista de pares
  `["HH:MM","HH:MM"]` con inicio < fin, sin solapes dentro del día, máx. 4
  franjas por día.
- `slot_minutes` 5..480, `buffer_minutes` 0..240, `min_lead_hours` 0..168,
  `horizon_days` 1..90, `timezone` válida para `Intl.DateTimeFormat`.
- `booking_instructions` ≤ 2.000 caracteres.

## Transiciones

- integración: `connected` ⇄ `reconnect_required` (reconectar = nuevo OAuth
  que reemplaza tokens y vuelve a `connected`); DELETE físico al desconectar.
- turno: `confirmed` → `cancelled` (guard WHERE status='confirmed').
