import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Adaptador OAuth 2.0 de Google (research D2) — ÚNICA frontera con la
 * autorización de Google (Constitución II, categoría 3). Sin `googleapis`:
 * son tres endpoints REST. Nada de acá loguea tokens.
 */

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export class GoogleAuthError extends Error {
  constructor(
    public readonly code: "invalid_grant" | "provider_error" | "not_configured",
    message: string
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export function redirectUri(): string {
  return `${getEnv().APP_BASE_URL.replace(/\/$/, "")}/api/integrations/google-calendar/callback`;
}

/* ---------- state firmado (CSRF) ---------- */

export type OAuthState = {
  orgId: string;
  userId: string;
  nonce: string;
  exp: number; // epoch ms
};

const STATE_TTL_MS = 10 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function hmac(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function signState(
  input: { orgId: string; userId: string },
  secret: string,
  now = Date.now()
): string {
  const state: OAuthState = {
    ...input,
    nonce: randomBytes(8).toString("hex"),
    exp: now + STATE_TTL_MS,
  };
  const payload = b64url(Buffer.from(JSON.stringify(state), "utf8"));
  return `${payload}.${hmac(payload, secret)}`;
}

/** null si la firma no coincide, expiró o el formato es inválido. */
export function verifyState(
  state: string,
  secret: string,
  now = Date.now()
): OAuthState | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = hmac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as Partial<OAuthState>;
    if (
      typeof parsed.orgId !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp < now) return null;
    return parsed as OAuthState;
  } catch {
    return null;
  }
}

/* ---------- URL de autorización ---------- */

export function buildAuthUrl(state: string): string {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID) {
    throw new GoogleAuthError("not_configured", "GOOGLE_CLIENT_ID ausente");
  }
  const url = new URL(env.GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  // offline + consent: garantiza refresh_token en CADA conexión (D2).
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

/* ---------- canje / refresh / revocación ---------- */

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  email: string | null;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(
  params: Record<string, string>,
  timeoutMs = 15_000
): Promise<TokenResponse> {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new GoogleAuthError("not_configured", "Google no configurado en la instancia");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(env.GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...params,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
      }).toString(),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok || !json.access_token) {
      // invalid_grant = refresh revocado/caducado → reconexión (D9).
      if (json.error === "invalid_grant") {
        throw new GoogleAuthError("invalid_grant", "Google rechazó la credencial (invalid_grant)");
      }
      throw new GoogleAuthError(
        "provider_error",
        `Google respondió ${res.status}: ${redact(json.error_description ?? json.error ?? "sin detalle")}`
      );
    }
    return json;
  } catch (err) {
    if (err instanceof GoogleAuthError) throw err;
    throw new GoogleAuthError(
      "provider_error",
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  const json = await tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
  });
  return {
    accessToken: json.access_token!,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
    email: json.id_token ? decodeIdTokenEmail(json.id_token) : null,
  };
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const json = await tokenRequest({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return {
    accessToken: json.access_token!,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000),
  };
}

/** Best-effort: jamás lanza (desconectar no debe fallar por Google). */
export async function revokeToken(token: string): Promise<void> {
  const env = getEnv();
  const revokeUrl = env.GOOGLE_TOKEN_URL.replace(/\/token$/, "/revoke");
  try {
    await fetch(`${revokeUrl}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // ignorado a propósito
  }
}

/**
 * Lee `email` del payload del id_token SIN verificar firma: viene directo de
 * Google por TLS en el canje server-to-server y solo se usa para display.
 */
export function decodeIdTokenEmail(idToken: string): string | null {
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8")
    ) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

function redact(s: string): string {
  return s.replace(/ya29\.[A-Za-z0-9_-]+/g, "ya29.***").slice(0, 300);
}
