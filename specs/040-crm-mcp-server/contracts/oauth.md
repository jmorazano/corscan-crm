# Contrato — Autorización (OAuth 2.1) del servidor MCP

`BASE` = `APP_BASE_URL` sin barra final. `RESOURCE` = `BASE/api/mcp`.
Todas las respuestas de error OAuth son JSON `{ "error", "error_description" }`
con los códigos estándar; `error_description` en castellano, sin datos
internos.

## 1. Desafío en el recurso

Cualquier pedido a `RESOURCE` sin token, con token inválido, vencido o de
una conexión no activa:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="BASE/.well-known/oauth-protected-resource/api/mcp"
Content-Type: application/json

{"error":"invalid_token","error_description":"Volvé a conectar el asistente"}
```

(`, error="invalid_token"` se agrega al encabezado solo si vino un token.)

## 2. Metadatos

`GET /.well-known/oauth-protected-resource/api/mcp` y
`GET /.well-known/oauth-protected-resource`:

```json
{
  "resource": "BASE/api/mcp",
  "authorization_servers": ["BASE"],
  "scopes_supported": ["crm.read"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Vocero CRM",
  "resource_documentation": "BASE/settings/assistants"
}
```

`GET /.well-known/oauth-authorization-server`:

```json
{
  "issuer": "BASE",
  "authorization_endpoint": "BASE/oauth/authorize",
  "token_endpoint": "BASE/api/oauth/token",
  "registration_endpoint": "BASE/api/oauth/register",
  "revocation_endpoint": "BASE/api/oauth/revoke",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "revocation_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["crm.read"]
}
```

Ambos con `Cache-Control: public, max-age=3600`.

## 3. Registro dinámico — `POST /api/oauth/register`

Pedido (RFC 7591; campos desconocidos se ignoran):

```json
{
  "client_name": "Claude",
  "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

`201`:

```json
{
  "client_id": "acl_…",
  "client_id_issued_at": 1792800000,
  "client_name": "Claude",
  "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

Errores: `400 invalid_redirect_uri` (fuera de la lista permitida o sin
ninguna), `400 invalid_client_metadata` (`token_endpoint_auth_method`
distinto de `none`, `grant_types` no soportados), `429` (10/h por IP).

## 4. Autorización — `GET /oauth/authorize` (página)

Parámetros: `response_type=code` · `client_id` · `redirect_uri` ·
`code_challenge` · `code_challenge_method=S256` · `state` (recomendado) ·
`resource` (opcional; si viene, = `RESOURCE`) · `scope` (opcional).

| Situación | Respuesta |
|---|---|
| `client_id` desconocido o `redirect_uri` no registrada para él | página de error, sin redirigir |
| otro parámetro inválido (`response_type`, falta PKCE, `plain`, `resource` ajeno) | `302 redirect_uri?error=invalid_request&error_description=…&state=…` |
| sin sesión | `302 /login?next=<esta URL>` |
| contraseña temporal | `302 /change-password?next=<esta URL>` |
| sin empresas autorizables | página explicativa + «Volver» (`error=access_denied`) |
| ok | consentimiento |

### `POST /api/oauth/authorize` (lo llama el consentimiento)

Sesión del CRM + `Origin: BASE`. Cuerpo:

```json
{
  "client_id": "acl_…",
  "redirect_uri": "https://claude.ai/api/mcp/auth_callback",
  "code_challenge": "…",
  "code_challenge_method": "S256",
  "state": "…",
  "resource": "BASE/api/mcp",
  "decision": "allow",
  "organization_ids": ["org_…", "org_…"]
}
```

`200 { "redirect": "https://claude.ai/api/mcp/auth_callback?code=…&state=…" }`
(con `decision: "deny"` → `?error=access_denied&state=…`).
`403` si `Origin` no coincide; `422 no_workspaces` si ninguna empresa
elegida es autorizable ahora mismo (se recalcula en el servidor).

## 5. Token — `POST /api/oauth/token`

`application/x-www-form-urlencoded` (se acepta también JSON).

Canje del código:

```
grant_type=authorization_code&code=…&redirect_uri=…&client_id=acl_…&code_verifier=…&resource=BASE/api/mcp
```

Renovación:

```
grant_type=refresh_token&refresh_token=vrt_…&client_id=acl_…
```

`200` (con `Cache-Control: no-store`):

```json
{
  "access_token": "vat_…",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "vrt_…",
  "scope": "crm.read"
}
```

Errores (`400` salvo indicación):

| Caso | `error` |
|---|---|
| código inexistente, vencido o ya usado (si ya usado, además se revoca la conexión emitida con él) | `invalid_grant` |
| `code_verifier` no coincide · `redirect_uri` o `client_id` distintos a los del código | `invalid_grant` |
| refresh inexistente, vencido o de conexión no activa | `invalid_grant` |
| refresh ya usado → se revoca la conexión (`refresh_reuse`) | `invalid_grant` |
| `client_id` desconocido | `401 invalid_client` (Claude re-registra) |
| `grant_type` distinto | `unsupported_grant_type` |
| exceso (30 / 10 min por IP) | `429` |

## 6. Revocación — `POST /api/oauth/revoke` (RFC 7009)

`token=…&token_type_hint=refresh_token|access_token&client_id=acl_…` →
siempre `200` (exista o no). Un token válido de la conexión la revoca
completa (`revoked_reason = 'user'`).
