# Data Model — 040 Conversar con el CRM desde Claude

Migración **0029** (`drizzle/0029_assistant_access.sql`, generada con
`pnpm db:generate`), solo aditiva: siete tablas nuevas, ninguna columna en
tablas existentes. Prefijo `assistant_` para no confundir con las tablas
del conector de 016 (`mcp_integration`, `mcp_tool_call`), donde Vocero es
*cliente*.

## Tablas con `organization_id` (dominio de la empresa)

### `assistant_settings` — el switch de la empresa (FR-005)

| Columna | Tipo | Notas |
|---|---|---|
| `organization_id` | text PK, FK `organization` cascade | una fila por empresa, creada al primer cambio |
| `enabled` | boolean NOT NULL default false | «Permitir asistentes externos» |
| `updated_by_user_id` | text NULL, FK `user` set null | quién lo cambió por última vez |
| `updated_at` | timestamp NOT NULL | |

Sin fila = apagado.

### `assistant_grant_org` — empresas incluidas en una conexión (FR-004)

| Columna | Tipo | Notas |
|---|---|---|
| `organization_id` | text NOT NULL, FK `organization` cascade | |
| `grant_id` | text NOT NULL, FK `assistant_grant` cascade | |
| `created_at` | timestamp NOT NULL | |

PK (`grant_id`, `organization_id`) · índice (`organization_id`, `grant_id`)
para «conexiones con acceso a mi empresa».

### `assistant_access_log` — registro de consultas (FR-025)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK `alog_…` | |
| `organization_id` | text NOT NULL, FK cascade | empresa consultada (o pedida, si fue rechazada y existe) |
| `grant_id` | text NULL, FK `assistant_grant` set null | |
| `user_id` | text NULL, FK `user` set null | |
| `client_label` | text NOT NULL | etiqueta copiada («Claude (claude.ai)»), sobrevive al cliente |
| `tool` | text NOT NULL | nombre de la herramienta |
| `summary` | text NOT NULL | lenguaje claro, ≤ 200 caracteres, sin contenido devuelto |
| `outcome` | text enum `ok` · `denied` · `error` | |
| `reason` | text NULL | `not_authorized` · `disabled` · `not_owner` · `invalid_args` · `not_found` · `rate_limited` · `internal` |
| `created_at` | timestamp NOT NULL | |

Índice (`organization_id`, `created_at` desc). Purga > 90 días.

Un pedido a una empresa que no existe o de la que el usuario no es
miembro NO se registra en esa empresa (no hay a quién mostrárselo y no se
filtra su existencia).

## Tablas de plataforma (sin `organization_id`)

Como `user` y `session` de Better Auth: pertenecen a una persona o a una
aplicación cliente, no a una empresa. La pertenencia a empresas vive en
`assistant_grant_org`. Justificación en el Constitution Check del plan.

### `assistant_client` — cliente registrado por DCR (FR-002)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK `acl_…` | es el `client_id` público |
| `client_name` | text NULL | lo que mandó el cliente; saneado, ≤ 80; dato no confiable |
| `redirect_uris` | text[] NOT NULL | ya validadas contra la lista permitida |
| `software_id`, `software_version` | text NULL | informativos |
| `created_at` | timestamp NOT NULL | |
| `last_authorized_at` | timestamp NULL | NULL a las 24 h → se borra |

### `assistant_grant` — la conexión (FR-023, FR-024)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK `agr_…` | |
| `user_id` | text NOT NULL, FK `user` cascade | quién autorizó |
| `client_id` | text NOT NULL, FK `assistant_client` cascade | |
| `client_label` | text NOT NULL | etiqueta derivada del retorno (research D4) |
| `scope` | text NOT NULL default `crm.read` | |
| `resource` | text NOT NULL | `<APP_BASE_URL>/api/mcp` |
| `status` | text enum `active` · `revoked` · `expired` | |
| `revoked_reason` | text enum NULL `user` · `owner` · `password_change` · `refresh_reuse` · `code_reuse` · `idle` | |
| `revoked_by_user_id` | text NULL, FK `user` set null | |
| `created_at`, `last_used_at`, `revoked_at` | timestamp | `last_used_at` se actualiza a lo sumo 1 vez por minuto |

Índice (`user_id`, `status`).

**Transiciones** (monotónicas, con guard en el WHERE):
`active → revoked` (cualquier motivo) · `active → expired` (90 días sin
uso, en el barrido o al intentar renovar). Nunca vuelve a `active`:
reconectar crea otra conexión. El switch de la empresa NO cambia el estado
(es un corte, no una revocación).

### `assistant_auth_code` — código de autorización (research D5/D6)

| Columna | Tipo | Notas |
|---|---|---|
| `code_hash` | text PK | SHA-256 del código |
| `client_id` | text NOT NULL, FK cascade | |
| `user_id` | text NOT NULL, FK `user` cascade | |
| `organization_ids` | text[] NOT NULL | elegidas en el consentimiento (≥ 1) |
| `redirect_uri` | text NOT NULL | exacta |
| `code_challenge` | text NOT NULL | S256 |
| `resource` | text NOT NULL | |
| `expires_at` | timestamp NOT NULL | +5 min |
| `used_at` | timestamp NULL | un solo uso |
| `grant_id` | text NULL | la conexión creada al canjearlo (para revocarla si se reusa) |

### `assistant_token` — tokens hasheados (FR-006)

| Columna | Tipo | Notas |
|---|---|---|
| `token_hash` | text PK | SHA-256 hex |
| `grant_id` | text NOT NULL, FK `assistant_grant` cascade | |
| `kind` | text enum `access` · `refresh` | |
| `expires_at` | timestamp NOT NULL | access +1 h · refresh +30 días |
| `used_at` | timestamp NULL | solo refresh: canjeado |
| `created_at` | timestamp NOT NULL | |

Índice (`grant_id`). Barrido diario de vencidos hace > 1 día.

## Prefijos nuevos en `src/lib/db/ids.ts`

`assistantClient: "acl"`, `assistantGrant: "agr"`, `assistantAccessLog:
"alog"`. Tokens y códigos no usan `newId` (son secretos de 32 bytes con
prefijos `vat_`/`vrt_`/sin prefijo para el código).

## Reglas de validación (puras)

- `redirect_uri`: lista exacta de Claude o loopback RFC 8252 (D4).
- `code_verifier`: 43–128 caracteres `[A-Za-z0-9-._~]`; `BASE64URL(SHA256)`
  = `code_challenge`.
- `next`: ruta relativa que empieza con `/oauth/authorize?`, sin `//`, sin
  esquema.
- Empresas elegidas: subconjunto de las membresías `owner` del usuario con
  `enabled = true` al momento del POST (se recalcula, no se confía en el
  formulario).
