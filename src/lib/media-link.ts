import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Enlace público FIRMADO a un adjunto saliente (026). Instagram no acepta
 * subir el binario en el envío: pide una URL que su servidor pueda bajar.
 * `/api/message-media` es privada (sesión + tenant), así que se firma un
 * enlace a ESE archivo con vencimiento — sin tabla, sin estado:
 * HMAC-SHA256 de `id.exp` con un secreto derivado del de la sesión (un
 * `state` de OAuth jamás sirve como firma de medios, ni al revés).
 *
 * Solo lo emite el envío de un adjunto: circulan únicamente enlaces a
 * archivos que el negocio decidió mandarle a un cliente.
 */

export const MEDIA_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** Secreto de firma: DERIVADO del de la sesión (como los `state` de OAuth). */
export function mediaLinkSecret(): string {
  return `${getEnv().BETTER_AUTH_SECRET}:media-link`;
}

function sign(mediaId: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${mediaId}.${exp}`).digest("base64url");
}

/** Ruta relativa con la firma (`/api/media-link/{id}?e=…&s=…`). */
export function signMediaLinkPath(
  mediaId: string,
  secret: string,
  now = Date.now(),
  ttlMs = MEDIA_LINK_TTL_MS
): string {
  const exp = now + ttlMs;
  const qs = new URLSearchParams({ e: String(exp), s: sign(mediaId, exp, secret) });
  return `/api/media-link/${encodeURIComponent(mediaId)}?${qs}`;
}

/** true solo con firma exacta y sin vencer. */
export function verifyMediaLink(
  mediaId: string,
  expRaw: string | null,
  sig: string | null,
  secret: string,
  now = Date.now()
): boolean {
  if (!expRaw || !sig || !/^\d{1,16}$/.test(expRaw)) return false;
  const exp = Number(expRaw);
  if (!Number.isSafeInteger(exp) || exp < now) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(mediaId, exp, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}
