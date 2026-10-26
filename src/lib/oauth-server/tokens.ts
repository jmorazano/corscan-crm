import { createHash, randomBytes } from "node:crypto";

/**
 * Secretos del servidor de autorización de los asistentes (040, research
 * D5). Módulo PURO: formato, hash y vencimientos.
 *
 * Access `vat_` y refresh `vrt_` + 32 bytes base64url (256 bits). En reposo
 * solo vive el SHA-256; se busca por ese hash (índice único), así que no
 * hace falta comparación en tiempo constante, igual que las `vk_` de 014.
 * El prefijo sirve para reconocerlos a simple vista; jamás se loguean.
 */

export const ACCESS_TOKEN_PREFIX = "vat_";
export const REFRESH_TOKEN_PREFIX = "vrt_";

export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;
export const CODE_TTL_S = 5 * 60;
/** Una conexión que no se usa en este lapso deja de renovarse. */
export const IDLE_EXPIRY_DAYS = 90;

/** El único alcance que existe en esta versión: solo lectura. */
export const ASSISTANT_SCOPE = "crm.read";

const ACCESS_PATTERN = /^vat_[A-Za-z0-9_-]{43}$/;
const REFRESH_PATTERN = /^vrt_[A-Za-z0-9_-]{43}$/;
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function random32(): string {
  return randomBytes(32).toString("base64url");
}

export function generateAccessToken(): string {
  return `${ACCESS_TOKEN_PREFIX}${random32()}`;
}

export function generateRefreshToken(): string {
  return `${REFRESH_TOKEN_PREFIX}${random32()}`;
}

export function generateAuthCode(): string {
  return random32();
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function looksLikeAccessToken(value: string): boolean {
  return ACCESS_PATTERN.test(value);
}

export function looksLikeRefreshToken(value: string): boolean {
  return REFRESH_PATTERN.test(value);
}

export function looksLikeAuthCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}

export function secondsFrom(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}

/** ¿La conexión lleva más de IDLE_EXPIRY_DAYS sin usarse? */
export function isIdle(lastUsedAt: Date | null, createdAt: Date, now: Date): boolean {
  const last = lastUsedAt ?? createdAt;
  return now.getTime() - last.getTime() > IDLE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
}
