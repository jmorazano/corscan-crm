/**
 * Espera del agente antes de responder (022): reglas PURAS.
 *
 * El agente no contesta al primer mensaje: espera a que el cliente termine
 * la ráfaga («hola» / «quería saber…» / «…para el finde») y responde UNA vez
 * con todo. Ese tiempo era de instancia (`AGENT_COALESCE_MS`, 20 s); ahora
 * cada empresa elige el suyo y el env queda como default.
 */

/** Tope: dos minutos. Más que eso ya no es «esperar la ráfaga», es no responder. */
export const REPLY_DELAY_MAX_MS = 120_000;
export const REPLY_DELAY_MIN_MS = 0;

/**
 * Espera efectiva en ms: el valor de la empresa si lo fijó (acotado), o el
 * default de la instancia. Un valor corrupto (NaN, negativo) cae al default.
 */
export function resolveReplyDelayMs(
  profileMs: number | null | undefined,
  instanceDefaultMs: number
): number {
  const fallback = clampDelay(instanceDefaultMs, instanceDefaultMs);
  if (profileMs === null || profileMs === undefined) return fallback;
  if (!Number.isFinite(profileMs)) return fallback;
  return clampDelay(profileMs, fallback);
}

function clampDelay(ms: number, fallback: number): number {
  if (!Number.isFinite(ms)) {
    return Number.isFinite(fallback) ? clampDelay(fallback, REPLY_DELAY_MIN_MS) : REPLY_DELAY_MIN_MS;
  }
  return Math.min(REPLY_DELAY_MAX_MS, Math.max(REPLY_DELAY_MIN_MS, Math.round(ms)));
}

/** Segundos (lo que edita la UI) → ms guardados; entrada vacía = null (default). */
export function replyDelaySecondsToMs(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const seconds = Number(trimmed);
  const ms = seconds * 1000;
  if (ms > REPLY_DELAY_MAX_MS) return "invalid";
  return ms;
}

/** ms → segundos para mostrar (redondeo al entero). */
export function replyDelayMsToSeconds(ms: number): number {
  return Math.round(ms / 1000);
}
