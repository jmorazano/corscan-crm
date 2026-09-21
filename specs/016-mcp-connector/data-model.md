# Data model — 016 Conector MCP por empresa (PMS)

Toda tabla lleva `organization_id NOT NULL` + índice org-first y se accede
por `scoped()` de `src/lib/db/tenant.ts` (Constitución III). Los UPDATE
también van por `scoped()` cuando el `organizationId` está en mano: no se
gasta la excepción del UPDATE-por-PK de `src/server/calendar/integration.ts:267`
(corrección #38).

El servidor MCP es de **solo lectura** y de un tercero: acá se guarda lo
mínimo para conectarlo, auditarlo y degradar sin romper nada (Constitución II,
categoría 5).

## `mcp_integration` (a lo sumo una por empresa)

La **existencia de la fila ES la habilitación** (D2): la escribe el super
admin, hace aparecer la tarjeta, y ninguna otra empresa la ve. Sin tabla de
flags y sin columnas nuevas en `organization` (tabla del plugin de Better
Auth, se deja intacta); es el mismo patrón por el que Administración deriva
`whatsappConnected` / `aiConfigured` de la existencia de una fila
(`src/server/admin/organizations.ts:288-302`).

| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | prefijo `mint_` |
| organization_id | text FK org, cascade | UNIQUE (`mcp_integration_org_uq`) |
| profile | text enum `generic` / `altos_de_calamuchita`, default `generic` | clave del registro `PROFILES`; `generic` = el agente no recibe herramientas |
| label | text NOT NULL | nombre visible en la tarjeta y en el prompt (2..80) |
| endpoint_url | text NOT NULL | endpoint JSON-RPC. Lo escribe **solo** el super admin (FR-001/FR-002); anti-SSRF al guardar y **de nuevo** en cada conexión sobre la IP resuelta (FR-003) |
| auth_scheme | text enum `bearer` / `api_key_header`, default `bearer` | corrección #15: **`meta` NO existe en v1** (metía el secreto en el cuerpo JSON-RPC). Cambiarlo borra la credencial, igual que cambiar la URL |
| credential | jsonb `{ cipher, iv, tag }` null | AES-256-GCM (`src/lib/crypto`). NULL = habilitada sin conectar. Jamás al cliente, a un log ni a un mensaje de error (FR-004, Constitución I) |
| credential_last4 | text null | único fragmento que ve la UI (patrón `tokenLast4`, `src/server/ai/credentials.ts:91-101`) |
| status | text enum `enabled` / `connected` / `reconnect_required` / `disabled`, default `enabled` | ver Transiciones |
| session_mode | text enum `stateless` / `initialize`, default `stateless` | lo decide el handshake, no una suposición. Contra el servidor real es `stateless` (hallazgo 1) |
| server_name / server_version / protocol_version | text null | del `initialize` (el real declara `2025-06-18`) |
| instructions | text null | `instructions` del `initialize`. **DATO del proveedor**: al prompt van saneadas, delimitadas con valla + nonce y truncadas a 1.500 (FR-011, correcciones #6 y #13) |
| use_server_instructions | boolean, default **false** | corrección #5: el texto ajeno NO entra al prompt salvo que el dueño lo active a mano |
| tools | jsonb `{ name, description }[]` null | `tools/list` congelado en el último handshake. `description` se guarda **ya saneada** y se rotula como texto del proveedor sin verificar (corrección #22): lo lee cualquier `member` |
| timezone | text NOT NULL, default `America/Argentina/Cordoba` | corrección #45. IANA (el primer cliente está en Córdoba; mismo offset que `America/Argentina/Buenos_Aires`, el default de `calendar_integration`). Fija qué día es «hoy» y qué significan «mañana» / «este finde» en el prompt y en el validador. Sin esto, en UTC, después de las 21 hs de Córdoba «mañana» da un día de más — el prime time de WhatsApp para cabañas |
| last_handshake_at | timestamp null | |
| last_error_code | text null | **código**, nunca bytes del remoto (corrección #13) |
| last_error_at | timestamp null | |
| catalog | jsonb null | catálogo **ya condensado** por `profile.parseCatalog` (ver abajo) |
| catalog_fetched_at | timestamp null | TTL vencido ⇒ stale-while-revalidate |
| catalog_ttl_minutes | integer, default 60 | 5..1440 |
| agent_tools_enabled | boolean, default true | el agente puede consultar (independiente de estar conectada) |
| timeout_ms | integer, default 10000 | 2000..30000. El servidor lo opera el cliente: su latencia no es nuestra (latencia real medida 0,66–1,31 s) |
| max_response_bytes | integer, default 524288 | 16384..4194304 |
| enabled_by | text null | user id del super admin |
| enabled_at | timestamp, default now | |
| connected_by | text null | user id del `owner` que pegó la credencial |
| connected_at | timestamp null | |
| created_at / updated_at | timestamp | |

### Decisiones y su porqué

- **`credential` como columna `jsonb` única y no la terna `cipher/iv/tag`.**
  Precedente verificado: `push_vapid_key.private_key`
  (`src/lib/db/schema.ts:795-797`, `jsonb(...).$type<{cipher,iv,tag}>()`).
  Acá el secreto es **nullable en bloque**; con tres columnas hay que
  mantener tres NULL sincronizados — el estado medio que ya es bug latente
  en `calendar_integration.access_token_*` (`schema.ts:718-720`). Una sola
  columna lo hace imposible de representar.
- **`status='enabled'` separado de `connected`.** Implementa la habilitación
  por empresa sin tabla de flags, y `disabled` apaga sin perder catálogo ni
  historial.
- **`catalog` guarda el condensado, no el JSON crudo.** `list-search-options`
  real pesa **16 KB** (82 características). Lo que se persiste es el
  `StayCatalog` que devuelve `profile.parseCatalog` (puro):

  ```ts
  type StayCatalog = {
    propertyTypes: string[];   // ["Cabaña","Casa","Casa con viñedo","Departamento","Suite de Montaña"]
    cities: string[];          // ["Potrero de Garay","San Clemente"]
    facilities: string[];      // solo los NOMBRES, saneados
    window: { from: string; to: string };   // "2026-09-21" → "2027-04-19"
    currency: string;          // "ARS"
    maxGuests: number | null;  // del error invalid_guests.max, si se conoce
  };
  ```

  Ningún valor se hard-codea: todos salen del catálogo (hallazgo 12 — la doc
  del dueño estaba desactualizada). Sin catálogo el conector igual funciona:
  el servidor valida y su error enseña a corregir.
- **`timeout_ms` / `max_response_bytes` por empresa** y no constantes de
  instancia: el servidor es del cliente.
- **Un servidor por empresa**: `uniqueIndex(organization_id)`, como
  `ai_credentials_org_uq` y `calendar_integration_org_uq`. Pasar a N después
  es `+ slug` y un unique compuesto — aditivo. Al revés, no.

## `mcp_tool_call` (bitácora de llamadas)

Diagnóstico, evidencia del sandbox (SC-003) y fuente de la última búsqueda de
la conversación (corrección #46). **No** es idempotencia tipo webhook: el
Principio IV rige lo ENTRANTE; lo saliente se reintenta y su resultado cambia
con el tiempo, por eso **no** hay unique sobre `args_hash`.

| Columna | Tipo | Notas |
|---|---|---|
| id | text PK | prefijo `mcall_` |
| organization_id | text FK org, cascade | |
| integration_id | text FK mcp_integration, cascade | |
| conversation_id | text FK conversation, **set null** | la métrica sobrevive al borrado del hilo (patrón `agent_change`) |
| tool | text NOT NULL | nombre real del proveedor (`check-availability`, `show-property`, `list-search-options`) |
| args_hash | text NOT NULL | SHA-256 de los argumentos normalizados (`node:crypto`) |
| args | jsonb null | argumentos enviados. **JAMÁS la credencial** |
| status | text enum `ok` / `error` | |
| error_code | text null | código estable del proveedor (`unknown_city`, `date_out_of_window`, `invalid_guests`, `unknown_property_type`, `invalid_date_range`, `property_not_found`, `unauthorized`…) o nuestro de transporte (`timeout`, `too_large`, `blocked_host`, `bad_payload`, `rate_limited`, `not_allowed`, `sandbox_violation`) |
| error_message | text null | **corrección #13**: proviene ÚNICAMENTE de `MCP_ERROR_TEXT` (FR-016). Nunca bytes del remoto: ni cuerpo, ni mensaje elegido por el tercero |
| http_status | integer null | |
| duration_ms | integer null | |
| response_bytes | integer null | |
| is_test | boolean, default false | las simuladas del Laboratorio: **jamás salieron a la red**, y con una query se demuestra |
| created_at | timestamp, default now | |

Índices:

- `mcp_tool_call_org_created_idx` (`organization_id`, `created_at`) — panel y poda.
- `mcp_tool_call_org_conv_idx` (`organization_id`, `conversation_id`,
  `created_at`) — **corrección #46**: `loadMcpContext` lee los args de la
  ÚLTIMA búsqueda de la conversación para renderizarlos en la sección del
  prompt. Sin esto, «¿y con pileta?» re-pregunta las fechas que el cliente ya
  dio. El índice lleva `created_at` porque la query es `ORDER BY created_at
  DESC LIMIT 1`.

Sin índice sobre `args_hash`: la caché anti-repetición es in-process (Map con
TTL 90 s), más barata que un round-trip a Postgres.

Sin `message_id` (a diferencia de `agent_change`, `schema.ts:410`): una
llamada al MCP puede no producir mensaje. La traza va por `conversation_id` +
`created_at`.

### Retención (corrección #24)

Poda oportunista 1 de cada 50 inserciones, **detached** —
`void podar().catch(() => undefined)`, nunca en el camino del turno — y
acotada:

```sql
DELETE FROM mcp_tool_call
 WHERE id IN (
   SELECT id FROM mcp_tool_call
    WHERE organization_id = $1 AND created_at < now() - interval '30 days'
    LIMIT 500
 );
```

Scopeada por empresa, con `LIMIT` para no tomar un lock largo. Sin cron y sin
colas (Constitución II).

## Prefijos de id — `src/lib/db/ids.ts`

```ts
  mcpIntegration: "mint",
  mcpToolCall: "mcall",
```

`cint` sentó el precedente `<proveedor>int` para integraciones; `mint` es
simétrico. Ninguno de los dos es prefijo de otro de los 24 existentes
(verificado).

## Validaciones (Zod)

| Campo | Regla |
|---|---|
| `label` | trim, 2..80 |
| `endpoint_url` | `url()`, ≤ 2048, y además `checkEndpointSyntax`: `https:` (única excepción `http:` sobre loopback bajo `isMockEnabled()`), sin userinfo, puerto vacío/443 (3000 bajo mocks), sin fragmento, hostname con al menos un punto y **`net.isIP()` = 0: las IP literales se rechazan** (corrección #1) |
| `auth_scheme` | `bearer` \| `api_key_header` |
| `credential` | trim, 8..4096 |
| `timezone` | válida para `Intl.DateTimeFormat` (misma regla que `src/server/calendar/rules.ts`) |
| `timeout_ms` | entero 2000..30000 |
| `max_response_bytes` | entero 16384..4194304 |
| `catalog_ttl_minutes` | entero 5..1440 |
| `instructions` | se persiste saneada y truncada a 1500 |
| `tools[].description` | se persiste saneada y truncada a 300 |

## Invariantes

1. `credential IS NULL` ⇒ `status ∈ {enabled, disabled}` (nunca `connected`).
2. Cambiar `endpoint_url` **o** `auth_scheme` ⇒ `credential = NULL`,
   `credential_last4 = NULL`, `status = 'enabled'`, `catalog = NULL`,
   `tools = NULL` (FR-005, corrección #15). Un super admin comprometido que
   reapunte el endpoint **no** cosecha el bearer en la llamada siguiente.
3. `profile = 'generic'` ⇒ el agente no recibe sección de prompt, ni
   acciones, ni llamadas: `allowedTools = []`.
4. Solo se invocan herramientas de `profile.allowedTools` (FR-007) y, además,
   solo las que el servidor anota `readOnlyHint: true` (las 3 reales lo
   declaran). Escrituras: estructuralmente imposibles.
5. `is_test = true` ⇒ la fila existe pero **no hubo red** (el corte vive
   dentro de `callGuarded`, corrección #25, y el transporte lanza
   `sandbox_violation` como segundo cinturón).

## Transiciones de `status`

```
        (super admin crea la fila)
                  ↓
              enabled ──credencial + verify OK──> connected
                  ↑                                  │
                  │                          unauthorized del servidor
   desconectar (DELETE de empresa)                    ↓
                  └──────────────────────────  reconnect_required
                                                      │
                                       credencial nueva + verify OK ─┘

  cualquiera ──DELETE admin ?mode=disable──> disabled ──PUT admin──> enabled
  cualquiera ──DELETE admin ?mode=remove──>  (fila borrada, cascade a mcp_tool_call)
```

- `reconnect_required` lo setea `markReconnectRequired` **solo** ante
  `unauthorized`. Un `timeout` o un `too_large` NO cambian el estado: una
  caída pasajera no es una credencial rota (solo mueven `last_error_*`).
- Desconectar (empresa) ≠ deshabilitar (super admin): el `DELETE` de empresa
  borra la credencial y vuelve a `enabled`, conservando catálogo y `tools`
  para no dejar el prompt vacío mientras se rota la credencial.

## Migración

`pnpm db:generate` → **`drizzle/0013_flashy_pretty_boy.sql`** (el nombre lo
sortea drizzle-kit, no se elige), junto con `drizzle/meta/0013_snapshot.json`
y la entrada `{"idx": 13, "version": "7", "when": <epoch>, "tag":
"0013_flashy_pretty_boy", "breakpoints": true}` en
`drizzle/meta/_journal.json`. La anterior es `0012_marvelous_roughhouse.sql`
(015).

Contenido, separado por `--> statement-breakpoint` (verificado contra el
archivo generado):

- 2 × `CREATE TABLE` (`mcp_integration`, `mcp_tool_call`);
- 4 × `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` — 3 `ON DELETE cascade`
  (`mcp_integration.organization_id`, `mcp_tool_call.organization_id`,
  `mcp_tool_call.integration_id`) + 1 `ON DELETE set null`
  (`mcp_tool_call.conversation_id`);
- 3 × índice: `CREATE UNIQUE INDEX mcp_integration_org_uq`,
  `CREATE INDEX mcp_tool_call_org_created_idx`,
  `CREATE INDEX mcp_tool_call_org_conv_idx`.

Sin backfill y sin datos sembrados: re-ejecutable por el journal
(Principio IV). Las migraciones se aplican al ARRANCAR el contenedor.
