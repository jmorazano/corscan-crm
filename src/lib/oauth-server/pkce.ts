import { createHash, timingSafeEqual } from "node:crypto";

/**
 * PKCE (RFC 7636) del servidor de autorización de los asistentes (040).
 * Solo S256: `plain` no se acepta (OAuth 2.1). Módulo PURO.
 */

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
/** BASE64URL(SHA-256) sin relleno: siempre 43 caracteres. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export function isValidCodeVerifier(value: string): boolean {
  return VERIFIER_RE.test(value);
}

export function isValidCodeChallenge(value: string): boolean {
  return CHALLENGE_RE.test(value);
}

export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/** ¿El verifier corresponde al challenge guardado con el código? */
export function verifyS256(verifier: string, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) return false;
  const a = Buffer.from(s256Challenge(verifier), "ascii");
  const b = Buffer.from(challenge, "ascii");
  return a.length === b.length && timingSafeEqual(a, b);
}
