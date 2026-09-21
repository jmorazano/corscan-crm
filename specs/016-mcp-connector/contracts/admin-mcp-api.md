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

## Qué NO está en este contrato

- **Verificar la conexión** — es del `owner` de la empresa; el super admin no
  toca credenciales de terceros más allá de dejar una cargada al habilitar.
- **Un segundo servidor MCP por empresa** — `uniqueIndex(organization_id)`.
  Pasar a N es aditivo (`+ slug` y unique compuesto); al revés, no.
- **Una env nueva** — la superficie de env de 016 es **cero exacto**
  (corrección #37): `.env.example` no recibe nada y `MCP_DEFAULT_ENDPOINT_URL`
  se descartó. El endpoint efectivo vive en `mcp_integration`; el instalador
  no necesita el conector (Constitución II categoría 5, letra g).
- **Perfiles nuevos** — agregar un PMS es un archivo en
  `src/server/mcp/profiles/` + una clave en el enum `profile`. Cero columnas
  nuevas, cero cambios en el pipeline.
