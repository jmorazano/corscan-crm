# Contrato — Administración del conector MCP (016, solo super admin)

Todos los endpoints bajo `withSuperAdmin` (`src/lib/api.ts:67-97`): sesión
válida + email en `SUPER_ADMIN_EMAILS`, sin exigir membresía de organización.
Sin sesión → `401 unauthorized`; sesión sin rol de plataforma → `403 forbidden`
(no 404: la sección existe, el acceso no). Envelope
`{ error: { code, message } }`; Zod → `422`.

**Por qué acá y no en Ajustes de la empresa**: la URL del servidor MCP la fija
**únicamente** el super admin (FR-001/FR-002, Constitución II categoría 5,
letra b). Un usuario de empresa no la escribe ni la lee; solo carga la
credencial que le pasó el proveedor (`contracts/mcp-integration-api.md`).

La **existencia de la fila `mcp_integration` ES la habilitación**: crearla hace
aparecer la tarjeta en esa empresa y en ninguna otra.

## DTO `McpAdminView` (corrección #36)

Distinto del `McpIntegrationView` de empresa: acá **sí** va la `endpointUrl`
completa, porque sin ella el botón «Editar» no tiene con qué precargar el
formulario. Nunca la credencial.

```jsonc
{
  "organizationId": "org_…",
  "profile": "altos_de_calamuchita",
  "label": "Altos de Calamuchita (reservas)",
  "endpointUrl": "https://altosdecalamuchita.com/mcp/assistant",  // completa (solo acá)
  "authScheme": "bearer",
  "status": "connected",
  "hasCredential": true,
  "credentialLast4": "3f9a",
  "sessionMode": "stateless",
  "timezone": "America/Argentina/Cordoba",
  "timeoutMs": 10000,
  "maxResponseBytes": 524288,
  "catalogTtlMinutes": 60,
  "agentToolsEnabled": true,
  "useServerInstructions": false,
  "serverName": "altos-mcp",
  "serverVersion": "1.4.0",
  "protocolVersion": "2025-06-18",
  "lastHandshakeAt": "ISO",
  "lastErrorCode": "timeout",         // CÓDIGO, nunca texto del remoto (#13)
  "lastErrorAt": "ISO",
  "enabledBy": "u_…",
  "enabledAt": "ISO",
  // corrección #23: otras empresas de la instancia con el MISMO host
  "sharedWith": [{ "organizationId": "org_…", "name": "Otra empresa" }]
}
```

`sharedWith` existe para que el super admin **vea** la correlación antes de
crearla: dos empresas apuntando al mismo endpoint comparten proveedor y, si
comparten credencial, comparten atribución de leads. La UI lo muestra como
aviso, no lo bloquea.

## `PUT /api/admin/organizations/[id]/mcp`

Habilita o reconfigura (upsert por `organization_id`; hay a lo sumo una fila).

```ts
type Params = { params: Promise<{ id: string }> };

const enableSchema = z.object({
  profile: z.enum(["generic", "altos_de_calamuchita"]),
  label: z.string().trim().min(2).max(80),
  endpointUrl: z.string().trim().url().max(2048),
  // corrección #15: 'meta' NO existe en v1 (metía el secreto en el cuerpo JSON-RPC)
  authScheme: z.enum(["bearer", "api_key_header"]).default("bearer"),
  /** Opcional: el dueño de la instancia puede dejarla cargada. */
  credential: z.string().trim().min(8).max(4096).optional(),
  /** Corrección #45: qué día es «hoy» para el agente. */
  timezone: z.string().trim().max(64).default("America/Argentina/Cordoba"),
  timeoutMs: z.coerce.number().int().min(2000).max(30000).default(10000),
  maxResponseBytes: z.coerce.number().int().min(16384).max(4194304).default(524288),
  catalogTtlMinutes: z.coerce.number().int().min(5).max(1440).default(60),
});
```

### Validación anti-SSRF (FR-003) — corre **acá**, y de nuevo en cada conexión

`checkEndpointSyntax` + resolución DNS previa (`assertResolvable`) sobre la IP
resuelta. Al guardar se valida para dar un error útil; la validación que
**protege** es la del socket (`guardedLookup` dentro de `https.request`), que
cierra la ventana de DNS rebinding.

| `reason` | Motivo |
|---|---|
| `not_https` | protocolo distinto de `https:` (única excepción: `http:` sobre loopback bajo `isMockEnabled()`, para el mcp-mock del self-test) |
| `userinfo` | la URL trae `user:pass@` (confunde parsers) |
| `bad_port` | puerto distinto de vacío/443 (3000 bajo mocks) |
| `ip_literal` | **corrección #1**: `net.isIP(hostname) !== 0`. Una IP literal esquivaba todo el anti-SSRF |
| `bad_host` | hostname sin punto |
| `too_long` | > 2048 |
| `blocked_host` | la IP resuelta cae en rango privado, loopback, link-local, CGNAT, multicast o metadata de nube (incluye el desmapeo de `::ffff:0:0/96` y las variantes `::/96`, `2002::/16`, `192.88.99.0/24`, `fec0::/10`) |
| `unresolvable` | el hostname no resuelve |

| Respuesta | Cuándo |
|---|---|
| `200 { ok: true, integration: McpAdminView }` | |
| `401 unauthorized` / `403 forbidden` | sin sesión / sin rol de plataforma |
| `404 organization_not_found` | |
| `422 invalid_body` | Zod, con el motivo |
| `422 invalid_endpoint { reason }` | tabla de arriba; el `message` sale de un texto fijo nuestro, nunca del remoto |

### Efecto clave (FR-005)

Si `endpointUrl` **o** `authScheme` cambian respecto de la fila existente:

```
credential = NULL · credentialLast4 = NULL · status = 'enabled'
catalog = NULL · tools = NULL · serverName/serverVersion/protocolVersion = NULL
```

Mismo principio que «cambiar el email de recuperación invalida la sesión»: un
super admin comprometido que reapunte el endpoint **no** cosecha el bearer en
la llamada siguiente. La UI lo avisa en rojo suave bajo el campo URL: «Cambiar
la dirección borra la credencial cargada: hay que volver a pegarla.»

Este PUT **no** dispara red: verificar es del `owner` de la empresa
(`POST /api/integrations/mcp/verify`). Así un servidor caído no impide
habilitar.

## `DELETE /api/admin/organizations/[id]/mcp?mode=disable|remove`

| `mode` | Efecto |
|---|---|
| `disable` (default) | `status = 'disabled'` + credencial borrada. Conserva catálogo, `tools` y toda la bitácora. La tarjeta desaparece de la empresa; el agente pierde la sección del prompt y las acciones |
| `remove` | Borra la fila. **Cascade** a `mcp_tool_call`: se pierde la evidencia del sandbox y el historial |

`200 { ok: true }`, idempotente (sin fila también responde 200) ·
`401` / `403` · `404 organization_not_found` · `422 invalid_body` (`mode`
desconocido).

## `GET /api/admin/organizations` (extendido)

`AdminOrganization` suma un campo, derivado igual que `whatsappConnected` /
`aiConfigured` (`src/server/admin/organizations.ts:288-302`):

```jsonc
{
  "id": "org_…", "name": "Altos de Calamuchita", "slug": "altos",
  "whatsappConnected": true, "aiConfigured": true,
  "mcp": {
    "enabled": true,
    "profile": "altos_de_calamuchita",
    "status": "connected",
    "endpointHost": "altosdecalamuchita.com",   // en la LISTA, solo el host
    "shared": false                              // true si otra empresa usa el mismo host
  },
  "members": [ … ]
}
```

`mcp: null` cuando no hay fila. La `endpointUrl` completa se sirve solo en el
`McpAdminView` del PUT o del detalle, no en el listado.

## Panel consolidado de conectores

Las rutas de arriba son las de **alta, edición y baja** de UNA empresa. Las de
esta sección son las de **observación y verificación de TODAS**: sin ellas, el
estado de una conexión solo se podía mirar empresa por empresa, entrando al
panel expandido de cada una, y con lo que la fila declara de sí misma —
nunca con lo que la bitácora `mcp_tool_call` sabe de si la conexión ANDA.

Módulo: `src/server/mcp/admin.ts`. Es **cross-tenant a propósito** (misma
excepción consciente del Principio III que `listOrganizations` y que
`sharedWithFor`), y por eso se sirve **únicamente** bajo `withSuperAdmin`. La
credencial no viaja nunca: solo `credentialLoaded` + `credentialLast4`. La
`endpointUrl` completa sí, porque el consumidor es el super admin (#36).

### DTO `McpConnectorRow`

```jsonc
{
  "organizationId": "org_…",
  "organizationName": "Altos de Calamuchita",
  "connector": {                      // null si la empresa no tiene fila
    "profile": "altos_de_calamuchita",
    "profileName": "Altos de Calamuchita",
    "label": "Altos de Calamuchita (reservas)",
    "endpointUrl": "https://altosdecalamuchita.com/mcp/assistant",  // completa
    "endpointHost": "altosdecalamuchita.com",
    "authScheme": "bearer",
    "status": "connected",            // enabled | connected | reconnect_required | disabled
    "sessionMode": "stateless",
    "serverName": "altos-mcp", "serverVersion": "1.4.0", "protocolVersion": "2025-06-18",
    "toolCount": 3,                   // cuántas expuso el último tools/list, no cuáles
    "credentialLoaded": true, "credentialLast4": "3f9a",   // el valor JAMÁS sale
    "agentToolsEnabled": true, "useServerInstructions": false,
    "timezone": "America/Argentina/Cordoba",
    "timeoutMs": 10000, "maxResponseBytes": 524288,
    "catalogTtlMinutes": 60, "catalogFetchedAt": "ISO|null",
    "catalogStale": false,            // venció el TTL; false si el perfil no tiene catálogo
    "enabledAt": "ISO", "connectedAt": "ISO|null", "lastHandshakeAt": "ISO|null",
    "lastErrorCode": "timeout|null",  // CÓDIGO, nunca texto del remoto (#13)
    "lastErrorAt": "ISO|null",
    "shared": false,
    "sharedWith": [{ "organizationId": "org_…", "name": "Otra empresa" }]
  },
  "health": {                         // de mcp_tool_call, SIN las filas is_test
    "calls24h": 40, "errors24h": 3,
    "calls7d": 210, "errors7d": 11,
    "sandboxCalls24h": 6,             // el Laboratorio, aparte: no salió a la red (SC-003)
    "lastCallAt": "ISO|null",
    "lastErrorCode": "timeout|null",  // el más reciente de los últimos 7 días
    "p50Ms": 812, "p95Ms": 2991,      // latencia de 24 h; null sin muestras
    "topErrors": [{ "code": "timeout", "n": 8 }]   // 7 días, top 3
  }
}
```

`health` viene en **cero** (no `null`) para una empresa sin conector o sin una
sola llamada: la UI no tiene que distinguir casos para pintar un número.

Las filas `is_test` se excluyen de toda la salud **a propósito**: nunca
salieron a la red, así que contarlas diría que el conector anda cuando jamás
se probó. Van en `sandboxCalls24h`, que es además la evidencia del sandbox.

### `GET /api/admin/mcp`

```jsonc
{
  "summary": {
    "organizations": 12, "withConnector": 4,
    "connected": 2, "reconnectRequired": 1, "enabled": 1, "disabled": 0,
    "withErrors24h": 1              // empresas con ≥1 error REAL en 24 h
  },
  "filters": { "q": "", "status": null },
  "organizations": [ McpConnectorRow, … ]
}
```

| Query | Efecto |
|---|---|
| `?q=` | texto libre sobre nombre de empresa, `endpointHost` o `label`; sin tildes y sin mayúsculas |
| `?status=` | `connected` · `reconnect_required` · `enabled` · `disabled` · `none` (empresas SIN conector) |

Un `status` desconocido **se ignora** (no es un 422): un filtro de la URL que
rompe la pantalla es peor que un filtro que no filtra. Los filtros son puros y
se testean solos: `parseMcpConnectorFilters` / `filterMcpConnectors`.

El `summary` es **siempre el de toda la instancia**, nunca el del subconjunto
filtrado: si filtrar cambiara el resumen, el semáforo dejaría de ser un
semáforo.

Orden de `organizations`: primero lo que necesita atención
(`reconnect_required` → con errores en 24 h → el resto → sin conector) y,
dentro de cada grupo, alfabético. El panel se lee de arriba hacia abajo.

`401 unauthorized` / `403 forbidden`.

### `GET /api/admin/mcp/[id]`

`200 { organization: McpConnectorRow & { recentCalls } }` — el mismo DTO más
las **últimas 20 llamadas** de la bitácora de esa empresa (esta query sí pasa
por `scoped()`: es la única lectura de datos de dominio de una sola empresa).

```jsonc
{
  "id": "mcall_…", "tool": "check-availability",
  "status": "ok",                    // ok | error
  "errorCode": null, "httpStatus": 200,
  "durationMs": 457, "responseBytes": 14820,
  "isTest": false, "conversationId": "cv_…", "createdAt": "ISO",
  // NO los args completos: solo escalares de una allowlist, saneados,
  // aplastados a una línea y truncados a 40 caracteres.
  "argsSummary": { "check_in": "2026-10-12", "check_out": "2026-10-14", "guests": 4 }
}
```

`argsSummary` existe para diagnosticar («pidió del 12 al 14 para 4 personas»)
sin convertir el panel del super admin en una pantalla para texto que escribió
un cliente por WhatsApp (FR-011, #22). Allowlist: `check_in`, `check_out`,
`guests`, `city`, `property_type`, `bedrooms`, `bathrooms`, `property`.

`404 organization_not_found` cuando la empresa no existe (una empresa sin
conector devuelve `200` con `connector: null`).

### `POST /api/admin/mcp/[id]/verify`

Handshake **en vivo** de cualquier empresa, disparado por el super admin. Es
lo que convierte el panel en gestión y no en lectura: hasta acá, para saber si
el conector de un cliente seguía vivo había que entrar como ese cliente.

Body vacío. Va por `handshakeGuarded` (`src/server/mcp/calls.ts`), **no** por
`handshake` a secas: mismo cupo de **6 por minuto POR EMPRESA** (#16), así que
esta ruta no es una puerta de atrás al cupo. Tras un handshake OK dispara el
prefetch del catálogo, igual que la verificación del `owner`.

| Respuesta | Cuándo |
|---|---|
| `200 { ok: true, organization: McpConnectorDetail }` | conector actualizado, listo para repintar la fila sin un GET extra |
| `401` / `403` | sin sesión / sin rol de plataforma |
| `404 organization_not_found` | la empresa no existe |
| `409 not_enabled` | la empresa no tiene el conector habilitado |
| `409 no_credential` | todavía no se cargó la credencial del proveedor |
| `429 rate_limited { retryInSeconds }` | cupo de 6/min de esa empresa |
| `502 provider_error { mcpCode, missingTools?, organization }` | el servidor falló; el conector va igual, porque `lastErrorCode`/`lastErrorAt` ya quedaron escritos y el fallo también es información |

Todo `message` sale de `MCP_ERROR_TEXT`; `mcpCode` es el código estable para
que la UI elija el banner. El super admin **no ve ni toca la credencial**: el
handshake la descifra dentro de `integration.ts` y de ahí no sale.

## Qué NO está en este contrato

- **Cargar o rotar la credencial de una empresa** — es del `owner`; el super
  admin solo puede dejar una cargada al habilitar. Verificar, en cambio, sí es
  suyo desde `POST /api/admin/mcp/[id]/verify` (arriba): dispara el handshake
  sin ver el secreto.
- **Un segundo servidor MCP por empresa** — `uniqueIndex(organization_id)`.
  Pasar a N es aditivo (`+ slug` y unique compuesto); al revés, no.
- **Una env nueva** — la superficie de env de 016 es **cero exacto**
  (corrección #37): `.env.example` no recibe nada y `MCP_DEFAULT_ENDPOINT_URL`
  se descartó. El endpoint efectivo vive en `mcp_integration`; el instalador
  no necesita el conector (Constitución II categoría 5, letra g).
- **Perfiles nuevos** — agregar un PMS es un archivo en
  `src/server/mcp/profiles/` + una clave en el enum `profile`. Cero columnas
  nuevas, cero cambios en el pipeline.
