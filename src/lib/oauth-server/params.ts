import { z } from "zod";
import { isValidCodeChallenge, isValidCodeVerifier } from "./pkce";
import { isAllowedRedirectUri, redirectMatchesRegistered } from "./redirect-uris";

/**
 * Validación de los pedidos del servidor de autorización de los asistentes
 * (040, specs/040-crm-mcp-server/contracts/oauth.md). Módulo PURO.
 */

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unsupported_grant_type"
  | "invalid_redirect_uri"
  | "invalid_client_metadata"
  | "access_denied"
  | "unsupported_response_type"
  | "invalid_scope";

export type OAuthError = { error: OAuthErrorCode; error_description: string };

export function oauthError(error: OAuthErrorCode, description: string): OAuthError {
  return { error, error_description: description };
}

// ---------------------------------------------------------------- registro

const registerSchema = z.object({
  client_name: z.string().max(500).optional(),
  redirect_uris: z.array(z.string()).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  software_id: z.string().max(200).optional(),
  software_version: z.string().max(100).optional(),
});

export type RegisterRequest = {
  clientName: string | null;
  redirectUris: string[];
  softwareId: string | null;
  softwareVersion: string | null;
};

const SUPPORTED_GRANTS = new Set(["authorization_code", "refresh_token"]);

export function parseRegisterRequest(
  body: unknown
): { ok: true; value: RegisterRequest } | { ok: false; error: OAuthError } {
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    const missingUris =
      typeof body === "object" && body !== null && !("redirect_uris" in body);
    return {
      ok: false,
      error: missingUris
        ? oauthError("invalid_redirect_uri", "Falta redirect_uris")
        : oauthError("invalid_client_metadata", "Metadatos del cliente inválidos"),
    };
  }
  const v = parsed.data;
  if (v.token_endpoint_auth_method !== undefined && v.token_endpoint_auth_method !== "none") {
    return {
      ok: false,
      error: oauthError(
        "invalid_client_metadata",
        "Solo se admiten clientes públicos (token_endpoint_auth_method = none)"
      ),
    };
  }
  if (v.grant_types && v.grant_types.some((g) => !SUPPORTED_GRANTS.has(g))) {
    return {
      ok: false,
      error: oauthError("invalid_client_metadata", "grant_types no soportados"),
    };
  }
  if (v.response_types && v.response_types.some((r) => r !== "code")) {
    return {
      ok: false,
      error: oauthError("invalid_client_metadata", "response_types no soportados"),
    };
  }
  const bad = v.redirect_uris.find((u) => !isAllowedRedirectUri(u));
  if (bad !== undefined) {
    return {
      ok: false,
      error: oauthError(
        "invalid_redirect_uri",
        "Dirección de retorno no permitida: solo las de Claude o loopback local"
      ),
    };
  }
  return {
    ok: true,
    value: {
      clientName: v.client_name ?? null,
      redirectUris: [...new Set(v.redirect_uris)],
      softwareId: v.software_id ?? null,
      softwareVersion: v.software_version ?? null,
    },
  };
}

// ----------------------------------------------------------- autorización

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
  resource: string;
};

/**
 * - `fatal`: cliente desconocido o retorno no registrado → página de error
 *   SIN redirigir (no se redirige a un destino no validado).
 * - `redirect`: el resto de los errores vuelven al cliente con `error=`.
 */
export type AuthorizeValidation =
  | { kind: "ok"; request: AuthorizeRequest }
  | { kind: "fatal"; message: string }
  | {
      kind: "redirect";
      redirectUri: string;
      state: string | null;
      error: OAuthErrorCode;
      description: string;
    };

export type AuthorizeParams = Record<string, string | undefined>;

export function validateAuthorizeRequest(
  params: AuthorizeParams,
  ctx: { resource: string; client: { id: string; redirectUris: readonly string[] } | null }
): AuthorizeValidation {
  const clientId = params.client_id ?? "";
  const redirectUri = params.redirect_uri ?? "";
  if (!ctx.client || ctx.client.id !== clientId) {
    return {
      kind: "fatal",
      message: "La aplicación que pidió acceso no está registrada. Volvé a conectarla desde el asistente.",
    };
  }
  if (!redirectUri || !redirectMatchesRegistered(redirectUri, ctx.client.redirectUris)) {
    return {
      kind: "fatal",
      message: "La dirección de retorno no coincide con la que registró la aplicación.",
    };
  }
  const state = params.state && params.state.length <= 1024 ? params.state : null;
  const fail = (error: OAuthErrorCode, description: string): AuthorizeValidation => ({
    kind: "redirect",
    redirectUri,
    state,
    error,
    description,
  });
  if (params.response_type !== "code") {
    return fail("unsupported_response_type", "Solo se admite response_type=code");
  }
  if (params.code_challenge_method !== "S256") {
    return fail("invalid_request", "PKCE obligatorio con code_challenge_method=S256");
  }
  const challenge = params.code_challenge ?? "";
  if (!isValidCodeChallenge(challenge)) {
    return fail("invalid_request", "code_challenge inválido");
  }
  if (params.resource !== undefined && params.resource !== "" && params.resource !== ctx.resource) {
    return fail("invalid_request", "resource no corresponde a este servidor");
  }
  return {
    kind: "ok",
    request: { clientId, redirectUri, codeChallenge: challenge, state, resource: ctx.resource },
  };
}

/** URL de vuelta al cliente con los parámetros dados (y `state` si hay). */
export function buildRedirect(
  redirectUri: string,
  params: Record<string, string>,
  state: string | null
): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (state !== null) u.searchParams.set("state", state);
  return u.toString();
}

// ------------------------------------------------------------------ token

export type TokenRequest =
  | {
      grantType: "authorization_code";
      code: string;
      redirectUri: string;
      clientId: string;
      codeVerifier: string;
      resource: string | null;
    }
  | { grantType: "refresh_token"; refreshToken: string; clientId: string };

export function parseTokenRequest(
  fields: Record<string, string | undefined>,
  ctx: { resource: string }
): { ok: true; value: TokenRequest } | { ok: false; error: OAuthError } {
  const grantType = fields.grant_type;
  const clientId = fields.client_id ?? "";
  if (grantType === "authorization_code") {
    const code = fields.code ?? "";
    const redirectUri = fields.redirect_uri ?? "";
    const codeVerifier = fields.code_verifier ?? "";
    if (!code || !redirectUri || !clientId) {
      return { ok: false, error: oauthError("invalid_request", "Faltan code, redirect_uri o client_id") };
    }
    if (!isValidCodeVerifier(codeVerifier)) {
      return { ok: false, error: oauthError("invalid_grant", "code_verifier inválido") };
    }
    const resource = fields.resource ? fields.resource : null;
    if (resource !== null && resource !== ctx.resource) {
      return { ok: false, error: oauthError("invalid_request", "resource no corresponde a este servidor") };
    }
    return {
      ok: true,
      value: { grantType, code, redirectUri, clientId, codeVerifier, resource },
    };
  }
  if (grantType === "refresh_token") {
    const refreshToken = fields.refresh_token ?? "";
    if (!refreshToken || !clientId) {
      return { ok: false, error: oauthError("invalid_request", "Faltan refresh_token o client_id") };
    }
    return { ok: true, value: { grantType, refreshToken, clientId } };
  }
  return {
    ok: false,
    error: oauthError("unsupported_grant_type", "Solo authorization_code y refresh_token"),
  };
}

/** Campos de un cuerpo form-urlencoded o JSON plano (valores de texto). */
export function fieldsFromBody(contentType: string | null, raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (contentType?.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") out[k] = v;
        }
      }
    } catch {
      // cuerpo inválido: sin campos → el validador responde invalid_request
    }
    return out;
  }
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}
