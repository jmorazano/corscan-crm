import { createHash, createHmac } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Adaptador OAuth 2.0 de Mercado Libre (025) — ÚNICA frontera con la
 * autorización de ML (Constitución II, categoría 3). Tres endpoints REST, sin
 * SDK. Nada de acá loguea tokens.
 *
 * Tres particularidades de ML que este archivo resuelve:
 *
 * 1. **El refresh token es de un solo uso y ROTA**: cada renovación devuelve
 *    uno nuevo y el anterior deja de servir. Por eso `refreshTokens` devuelve
 *    los dos, y quien lo llama tiene que persistir el nuevo en el mismo update
 *    (`src/server/meli/integration.ts`).
 * 2. **PKCE S256** (opcional en la app, obligatorio si la app lo tiene
 *    activado): el `code_verifier` se DERIVA del nonce del state firmado con
 *    un HMAC del secreto de la instancia. Así no hace falta guardarlo en
 *    ningún lado y nunca viaja en una URL — quien intercepte `code` + `state`
 *    no puede reconstruirlo sin el secreto.
 * 3. **El `redirect_uri` tiene que ser idéntico** al configurado en la app:
 *    nada variable en la URL; todo lo nuestro viaja en `state`.
 */

export class MeliAuthError extends Error {
  constructor(
    public readonly code: "invalid_grant" | "provider_error" | "not_configured",
    message: string
  ) {
    super(message);
    this.name = "MeliAuthError";
  }
}

export function redirectUri(): string {
  return `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/api/integrations/mercadolibre/callback`;
}

/**
 * Secreto del `state` de ESTA integración: derivado del de la instancia para
 * que un state emitido para Google o Instagram no sirva en este callback.
 */
export function meliStateSecret(): string {
  return `${getEnv().BETTER_AUTH_SECRET}:mercadolibre`;
}

/* ---------- PKCE derivado (sin almacenamiento) ---------- */

/**
 * `code_verifier` de 43 caracteres base64url (el mínimo del RFC 7636) a
 * partir del nonce del state. Determinista: el callback lo recalcula con el
 * mismo nonce. El prefijo separa este uso del HMAC de cualquier otro.
 */
export function pkceVerifier(nonce: string, secret: string): string {
  return createHmac("sha256", secret).update(`meli-pkce:${nonce}`).digest("base64url");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/* ---------- URL de autorización ---------- */

export function buildAuthUrl(state: string, codeChallenge: string): string {
  const env = getEnv();
  if (!env.MELI_CLIENT_ID) {
    throw new MeliAuthError("not_configured", "MELI_CLIENT_ID ausente");
  }
  const url = new URL(env.MELI_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.MELI_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/* ---------- canje / refresh ---------- */

export type MeliTokenSet = {
  accessToken: string;
  /** Siempre presente con `offline_access`; sin él no hay conexión durable. */
  refreshToken: string | null;
  expiresAt: Date;
  /** Id numérico de la cuenta de ML, como texto. */
  userId: string | null;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user_id?: number | string;
  error?: string;
  message?: string;
  error_description?: string;
};

export function tokenUrl(): string {
  return `${getEnv().MELI_API_BASE_URL.replace(/\/$/, "")}/oauth/token`;
}

async function tokenRequest(
  params: Record<string, string>,
  timeoutMs = 15_000
): Promise<TokenResponse> {
  const env = getEnv();
  if (!env.MELI_CLIENT_ID || !env.MELI_CLIENT_SECRET) {
    throw new MeliAuthError("not_configured", "Mercado Libre no configurado en la instancia");
  }
  try {
    const res = await fetch(tokenUrl(), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        ...params,
        client_id: env.MELI_CLIENT_ID,
        client_secret: env.MELI_CLIENT_SECRET,
      }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok || !json.access_token) {
      // invalid_grant = code/refresh inválido, revocado, vencido o ya usado
      // (el refresh es de un solo uso) → la empresa tiene que reconectar.
      if (json.error === "invalid_grant") {
        throw new MeliAuthError("invalid_grant", "Mercado Libre rechazó la credencial (invalid_grant)");
      }
      throw new MeliAuthError(
        "provider_error",
        `Mercado Libre respondió ${res.status}: ${redact(json.error ?? json.message ?? "sin detalle")}`
      );
    }
    return json;
  } catch (err) {
    if (err instanceof MeliAuthError) throw err;
    throw new MeliAuthError("provider_error", err instanceof Error ? err.message : String(err));
  }
}

function toTokenSet(json: TokenResponse): MeliTokenSet {
  return {
    accessToken: json.access_token!,
    refreshToken: json.refresh_token ?? null,
    // ML emite tokens de 6 h; si no informa el vencimiento se asume eso.
    expiresAt: new Date(Date.now() + (json.expires_in ?? 21_600) * 1000),
    userId: json.user_id === undefined || json.user_id === null ? null : String(json.user_id),
  };
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<MeliTokenSet> {
  const json = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: codeVerifier,
  });
  return toTokenSet(json);
}

/**
 * Renueva con el refresh token. Devuelve el refresh NUEVO: el viejo ya no
 * sirve después de esta llamada, haya salido bien o mal lo que venga después.
 */
export async function refreshTokens(refreshToken: string): Promise<MeliTokenSet> {
  const json = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return toTokenSet(json);
}

/** Tapa cualquier token con forma de ML en un mensaje de error. */
export function redact(s: string): string {
  return s
    .replace(/APP_USR-[A-Za-z0-9_-]+/g, "APP_USR-***")
    .replace(/TG-[A-Za-z0-9_-]+/g, "TG-***")
    .slice(0, 300);
}
