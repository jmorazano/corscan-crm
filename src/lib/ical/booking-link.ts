/**
 * Enlace PROPIO de reservas del complejo (051, decisión 3 del dueño): el
 * agente nunca manda la publicación de Airbnb. Puede llevar `{entrada}`,
 * `{salida}` y `{huespedes}` si el sitio del complejo los acepta.
 */

export const BOOKING_PLACEHOLDERS = ["{entrada}", "{salida}", "{huespedes}"] as const;
const MAX_BOOKING_URL = 500;

export type BookingUrlCheck = { ok: true; url: string } | { ok: false; code: "malformed" | "not_https" | "too_long" };

/** Valida el enlace al guardarlo (con los marcadores reemplazados por valores de prueba). */
export function checkBookingUrl(raw: string, options: { allowHttpLoopback?: boolean } = {}): BookingUrlCheck {
  const value = raw.trim();
  if (value.length > MAX_BOOKING_URL) return { ok: false, code: "too_long" };
  const probe = fillPlaceholders(value, { from: "2026-01-01", to: "2026-01-02", guests: 2 });
  let url: URL;
  try {
    url = new URL(probe);
  } catch {
    return { ok: false, code: "malformed" };
  }
  if (url.username || url.password) return { ok: false, code: "malformed" };
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(options.allowHttpLoopback && loopback && url.protocol === "http:")) {
    return { ok: false, code: "not_https" };
  }
  return { ok: true, url: value };
}

function fillPlaceholders(template: string, q: { from: string; to: string; guests: number | null }): string {
  return template
    .replaceAll("{entrada}", encodeURIComponent(q.from))
    .replaceAll("{salida}", encodeURIComponent(q.to))
    .replaceAll("{huespedes}", q.guests === null ? "" : encodeURIComponent(String(q.guests)));
}

/** El enlace que ve el cliente: el de la unidad o el general, con las fechas. */
export function buildStayBookingLink(
  template: string | null | undefined,
  q: { from: string; to: string; guests: number | null }
): string | null {
  if (!template) return null;
  const filled = fillPlaceholders(template.trim(), q);
  try {
    return new URL(filled).toString();
  } catch {
    return null;
  }
}
