# Contrato — API del conector MCP de empresa (016)

Todas las rutas van con `withAuth` (sesión + organización, `src/lib/api.ts:32`)
y toda query por `scoped()`. Errores con el envelope estándar
`{ error: { code, message } }` vía `apiError` (`src/lib/api.ts:16-26`); body
por `parseBody` → 422 `invalid_body`; `export const dynamic = "force-dynamic"`.

**Mutaciones solo `owner`** (403 `forbidden` para `member`, FR-006).

Dos cosas que **jamás** salen por esta API:

1. La **credencial** (FR-004). A la UI solo `credentialLast4`.
2. La **`endpointUrl` completa**: un usuario de empresa no la escribe (FR-002)
   ni la lee — solo el **host**. La URL entera es del super admin
   (`contracts/admin-mcp-api.md`).

## Tres capas de defensa (la habilitación es por empresa, FR-001)

1. `GET /api/integrations` no incluye el ítem `mcp` si no hay fila.
2. `src/app/(app)/integrations/mcp/page.tsx` es `async` y hace `notFound()`
   sin fila (patrón literal de `src/app/(app)/settings/datos/page.tsx:8-11`).
3. **Cada endpoint de acá devuelve `404 not_enabled`** aunque adivinen la URL.
   Ocultar el ítem es cosmética; la defensa es server-side.

## `MCP_ERROR_TEXT` — única fuente de los mensajes (FR-016, corrección #13)

Módulo puro `src/lib/mcp/error-text.ts` (sin I/O, importable por el route
handler **y** por el componente cliente). Es la **única** fuente del `message`
que sale por HTTP, del texto que muestra la UI y de
`mcp_tool_call.error_message`. Los bytes del remoto no se devuelven, no se
muestran y no se persisten: a lo sumo `httpStatus` y `responseBytes`.

Cierra tres cosas a la vez: el oráculo semi-ciego de SSRF, el canal para que
el tercero escriba castellano elegido por él en nuestra pantalla, y la
exfiltración por la UI.

```ts
export const MCP_ERROR_TEXT: Record<McpErrorCode | "rate_limited" | "not_allowed", string> = {
  invalid_url:         "La dirección del servidor no es válida. Avisale al administrador de la instancia.",
  blocked_host:        "La dirección del servidor no es válida. Avisale al administrador de la instancia.",
  unexpected_redirect: "El servidor respondió con una redirección; por seguridad no la seguimos.",
  bad_content_type:    "El servidor respondió en un formato que no entendemos.",
  timeout:             "El servidor no respondió a tiempo. Probá de nuevo en un minuto.",
  too_large:           "La respuesta del servidor es demasiado grande.",
  http_error:          "El servidor respondió con un error. Probá de nuevo en un minuto.",
  rpc_error:           "El servidor rechazó la consulta.",
  bad_payload:         "El servidor respondió algo que no pudimos interpretar.",
  unauthorized:        "El servidor rechazó la credencial. Pedile una nueva al proveedor y volvé a cargarla.",
  tool_error:          "El servidor no pudo resolver la consulta.",
  sandbox_violation:   "Consulta bloqueada: las conversaciones de prueba no salen al servidor real.",
  rate_limited:        "Muchas consultas seguidas. Esperá un minuto.",
  not_allowed:         "Esa herramienta no está habilitada para este conector.",
};
// código desconocido → "No se pudo conectar con el servidor."
```

`blocked_host` e `invalid_url` comparten texto **a propósito**: distinguirlos
le diría al que sondea si el host existía.

## DTO `McpIntegrationView`

Lo único que ve una empresa. Sin credencial, sin URL completa, sin texto del
tercero sin rotular.

```jsonc
{
  "profile": "altos_de_calamuchita",
  "profileName": "Altos de Calamuchita (alojamientos)",
  "label": "Altos de Calamuchita (reservas)",
  "endpointHost": "altosdecalamuchita.com",   // SOLO el host (FR-002)
  "status": "connected",                       // enabled | connected | reconnect_required | disabled
  "credentialLast4": "3f9a",                   // null si no hay credencial
  "serverName": "altos-mcp",
  "serverVersion": "1.4.0",
  "protocolVersion": "2025-06-18",
  "sessionMode": "stateless",
  "timezone": "America/Argentina/Cordoba",
  "tools": [                                   // texto del PROVEEDOR, ya saneado (#22)
    { "name": "check-availability", "description": "…", "readOnly": true }
  ],
  "instructions": "…",                         // saneada y truncada a 1500; null si no hay
  "useServerInstructions": false,              // default false (#5)
  "agentToolsEnabled": true,
  "catalog": {                                 // condensado; null si nunca se pudo traer
    "propertyTypes": ["Cabaña", "Casa", "Casa con viñedo", "Departamento", "Suite de Montaña"],
    "cities": ["Potrero de Garay", "San Clemente"],
    "facilitiesCount": 82,
    "window": { "from": "2026-09-21", "to": "2027-04-19" },
    "currency": "ARS"
  },
  "catalogFetchedAt": "ISO",
  "lastHandshakeAt": "ISO",
  "lastErrorCode": "timeout",                  // CÓDIGO, nunca texto del remoto (#13)
  "lastErrorAt": "ISO",
  "enabledAt": "ISO"
}
```

`tools[].description` e `instructions` son **texto del proveedor sin
verificar**: llegan saneados (`sanitizeForeignText`) y la UI los rotula como
tales. Los lee cualquier `member`.

## `GET /api/integrations` (extendido)

```jsonc
{ "integrations": [
  { "key": "google_calendar", "name": "Google Calendar", "available": true,
    "connected": true, "status": "connected", "accountEmail": "agenda@negocio.com" },
  // presente SOLO si existe fila mcp_integration con status != 'disabled'
  { "key": "mcp", "name": "Altos de Calamuchita (reservas)", "available": true,
    "connected": true, "status": "connected", "accountEmail": null,
    "detail": "altosdecalamuchita.com" }
]}
```

Para esta tarjeta `available` **no** es una env de instancia (como
`isGoogleIntegrationConfigured()`) sino «existe fila»: la habilitación es por
empresa. `detail` es campo nuevo del DTO — pone el host donde Google pone el
email.

## `GET /api/integrations/mcp`

`200 { "available": true, "integration": McpIntegrationView, "canManage": true }`
(`canManage` = `session.role === "owner"`).

Sin fila → `200 { "available": false, "integration": null, "canManage": … }`
(la página igual hace `notFound()`; este 200 es para el fetch del cliente).

`401 unauthorized`.

## `PUT /api/integrations/mcp`

Carga o rota la credencial y los ajustes del dueño.

```ts
const putSchema = z
  .object({
    credential: z.string().trim().min(8).max(4096).optional(),
    agentToolsEnabled: z.boolean().optional(),
    useServerInstructions: z.boolean().optional(),
    // corrección #45: qué día es «hoy» para el agente y el validador
    timezone: z.string().trim().max(64).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nada que actualizar");
```

Efectos: cifra con `encryptSecret` (AES-256-GCM), guarda `credentialLast4`,
`connectedBy` y `connectedAt`. **No dispara red**: verificar es explícito
(endpoint siguiente), para que un servidor caído no impida guardar la
credencial.

| Respuesta | Cuándo |
|---|---|
| `200 { ok: true }` | |
| `403 forbidden` | `member` (FR-006) |
| `404 not_enabled` | sin fila — «Esta empresa no tiene el conector habilitado» |
| `422 invalid_body` | Zod, con el motivo (`timezone` inválida para `Intl.DateTimeFormat`) |

## `POST /api/integrations/mcp/verify`

Handshake en vivo. Body vacío.

Efectos, en orden: `checkEndpointSyntax` + resolución guardada
(`assertSafeEndpoint`, re-validación anti-SSRF sobre la IP resuelta, FR-003) →
`initialize` (si el servidor exige `Mcp-Session-Id`, `sessionMode='initialize'`;
contra el real es `stateless`) → `tools/list` → chequeo de
`profile.requiredTools` → prefetch de `profile.catalogTool` → `recordHandshake`
+ `status='connected'` + catálogo fresco + `lastErrorCode = null`.

Va por `handshakeGuarded`, con rate limit propio **6/min por empresa**
(corrección #16): sin él, «`calls.ts` es el único lugar que llama al MCP» era
falso.

| Respuesta | Cuándo |
|---|---|
| `200 { ok: true, integration: McpIntegrationView }` | |
| `403 forbidden` | `member` |
| `404 not_enabled` | sin fila |
| `409 no_credential` | «Cargá la credencial antes de verificar» |
| `429 rate_limited { retryInSeconds }` | > 6 verificaciones por minuto |
| `502 provider_error { code, message, mcpCode }` | `message` **solo** de `MCP_ERROR_TEXT`; `mcpCode` es el `McpErrorCode` para que la UI elija el banner |

Caso especial: si el servidor no expone alguna de `profile.requiredTools`, el
502 lleva `mcpCode: "bad_payload"` y, además de `message`, el campo
`missingTools: string[]` — nombres de **nuestra** lista, no texto del remoto.

Un `unauthorized` acá deja `status='reconnect_required'`.

## `DELETE /api/integrations/mcp`

**Desconectar, no deshabilitar.** `credential = null`,
`credentialLast4 = null`, `status = 'enabled'`; `catalog` y `tools` se
conservan (son públicos, no son secreto, y evitan un vacío en el prompt
mientras se rota la credencial). Idempotente.

`200 { ok: true }` · `403 forbidden` · `404 not_enabled`.

La fila solo la borra el super admin (`?mode=remove` en el otro contrato).

## `POST /api/integrations/mcp/preview`

La vista previa del dueño — el «lo probé y anda». Análogo de
`GET …/google-calendar/availability`.

```ts
const previewSchema = z.object({
  check_in:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  check_out: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guests:    z.coerce.number().int().min(1).max(50),
});
```

Pasa por `callGuarded` (allowlist del perfil → rate limit 60/min por empresa →
caché 90 s → bitácora en `mcp_tool_call`), con `sandbox: false` y
`conversationId: null`.

Respuesta 200 — ya condensada, saneada y con las URLs filtradas por
`profile.linkHosts` (FR-010):

```jsonc
{
  "message": "5 alojamientos disponibles para las fechas y la cantidad de huéspedes consultadas.",
  "searchUrl": "https://altosdecalamuchita.com/buscar?in=2026-09-25&out=2026-09-27&c=4",
  "availableCount": 5,
  "properties": [
    { "code": "AC-003", "name": "Casa Perla Negra", "city": "Potrero de Garay",
      "capacity": 6, "bedrooms": 3, "bathrooms": 2, "minStay": 2,
      "facilities": ["Pileta", "Asador", "Wifi"],
      "pricing": { "currency": "ARS", "nights": 2, "pricePerNight": 300000,
                   "accommodation": 600000, "services": 0,
                   "total": 600000, "deposit": 60000 },
      "url": "https://altosdecalamuchita.com/alquiler-temporario-casa-perla-negra-potrero-de-garay" }
  ]
}
```

Reglas del render, iguales a las del `[HERRAMIENTA]` del agente:

- El `message` «listo para enviar» del proveedor **no se propaga a un
  contacto**: acá se muestra al dueño, rotulado, y nunca se usa como respaldo
  de `properties: []` (corrección #8 — `properties: []` es un estado que el
  servidor elige).
- `deposit` se **muestra**, jamás se calcula: no es un % fijo, varía por
  propiedad (hallazgo 14).
- `currency` se imprime tal cual; si no es `ARS` **no se convierte**.
- Toda URL pasa por `safeLink` (`h === d || h.endsWith("." + d)`, https, sin
  userinfo, href ≤ 512, strip del punto final del FQDN — corrección #17); lo
  que no matchea se **omite**.
- Nunca se arma un enlace a mano: se usa el `search_url` que devuelve el
  servidor (el buscador del sitio filtra distinto que el MCP, hallazgo 13).
- Cada campo textual pasa por `sanitizeForeignText` y se trunca (nombre 80,
  características 6 ítems).

| Respuesta | Cuándo |
|---|---|
| `200 {...}` | |
| `403 forbidden` | `member` |
| `404 not_enabled` | sin fila |
| `409 not_connected` | `status != 'connected'` o sin credencial |
| `422 invalid_body` | Zod |
| `429 rate_limited { retryInSeconds: 60 }` | rate limit de `callGuarded` |
| `502 provider_error { code, message, mcpCode, providerCode? }` | `message` de `MCP_ERROR_TEXT`; `providerCode` es el código **estable** del proveedor (`unknown_city`, `date_out_of_window`, `invalid_guests`, `unknown_property_type`, `invalid_date_range`, `property_not_found`) para que la UI muestre su propia ayuda |

Los errores del servidor llegan con **HTTP 200 + `result.isError: true`** y el
detalle en un JSON anidado dentro de `result.content[0].text` (hallazgo 3):
el status HTTP nunca alcanza. `unwrapToolResult` es quien lo desarma; este
endpoint solo ve `McpCallOutcome`.

## Notas transversales

- **`is_test` jamás llega acá**: la vista previa es del dueño y corre con
  `sandbox: false`. El sandbox del Laboratorio se responde con fixtures
  (`profile.sandbox`) y deja fila `mcp_tool_call.is_test = true` sin tocar la
  red (FR-013, corrección #25).
- **Ningún endpoint lanza hacia afuera**: todo `catch` degrada a un código de
  `MCP_ERROR_TEXT`. Una caída del PMS no tumba el turno, la ingesta ni el
  envío (FR-012, Constitución II categoría 5, letra j).
- **Datos personales al tercero**: se manda `conversation_id` (nuestro
  `cv_…`, nanoid opaco) y nada más — nunca teléfono ni nombre. Viaja como
  `cid=` en `search_url` y en cada `properties[].url`, y le da al proveedor la
  atribución del lead (hallazgo 11).
