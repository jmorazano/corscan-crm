import { ASSISTANT_SCOPE } from "./tokens";

/**
 * Descubrimiento del servidor MCP de los asistentes (040, research D3 y
 * specs/040-crm-mcp-server/contracts/oauth.md §1–2). Módulo PURO.
 *
 * Detalle que rompe la conexión de Claude Desktop si falta: todo 401 del
 * recurso lleva `WWW-Authenticate` con `resource_metadata`.
 */

export const MCP_PATH = "/api/mcp";

/** `APP_BASE_URL` sin barra final: es el `issuer`. */
export function normalizeBase(appBaseUrl: string): string {
  return appBaseUrl.replace(/\/+$/, "");
}

export function resourceUrl(base: string): string {
  return `${normalizeBase(base)}${MCP_PATH}`;
}

export function protectedResourceMetadataUrl(base: string): string {
  return `${normalizeBase(base)}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

export function authorizationServerMetadata(base: string) {
  const b = normalizeBase(base);
  return {
    issuer: b,
    authorization_endpoint: `${b}/oauth/authorize`,
    token_endpoint: `${b}/api/oauth/token`,
    registration_endpoint: `${b}/api/oauth/register`,
    revocation_endpoint: `${b}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [ASSISTANT_SCOPE],
  };
}

export function protectedResourceMetadata(base: string) {
  const b = normalizeBase(base);
  return {
    resource: resourceUrl(b),
    authorization_servers: [b],
    scopes_supported: [ASSISTANT_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Vocero CRM",
    resource_documentation: `${b}/settings/assistants`,
  };
}

/** Encabezado del 401 del recurso. */
export function wwwAuthenticate(base: string, opts: { invalidToken: boolean }): string {
  const parts = [`resource_metadata="${protectedResourceMetadataUrl(base)}"`];
  if (opts.invalidToken) parts.push(`error="invalid_token"`);
  return `Bearer ${parts.join(", ")}`;
}
