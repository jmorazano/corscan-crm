import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * `state` firmado del flujo OAuth (CSRF), compartido por los adaptadores de
 * Google (005) e Instagram (023). Sin almacenamiento: payload JSON en
 * base64url + HMAC-SHA256, con vencimiento de 10 minutos. El vínculo con la
 * empresa y el usuario lo comprueba cada callback contra la sesión.
 *
 * Cada integración firma con un secreto DISTINTO (derivado), para que un
 * `state` emitido para Google no sirva en el callback de Instagram.
 */

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

