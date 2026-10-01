import { compactDate, isIsoDate } from "./dates";

/**
 * Enlace al motor de reservas de MiniHotel (028), con la búsqueda cargada.
 *
 * La BASE la fija el super admin (es un enlace que va a recibir un cliente
 * real, igual que la dirección de la API) y se valida acá contra los
 * dominios del proveedor. Los parámetros los arma el código —jamás el
 * modelo—, así el huésped siempre aterriza en las fechas y la cantidad de
 * personas que consultó.
 *
 * Formato documentado (1-oct-2026):
 * `https://frame2.hotelpms.io/BookingFrameClient/hotel/{HotelID}/{InstanceID}/book/rooms`
 * con `from`/`to` (YYYYMMDD), `nAdults`, `nChilds`, `nBabies`, `roomType`,
 * `currency` y `language`.
 */

/** Dominios del proveedor (exactos o subdominios: frame1/frame2, sandbox). */
export const BOOKING_LINK_DOMAINS = ["hotelpms.io", "minihotel.cloud"] as const;

export const DEFAULT_BOOKING_LANGUAGE = "es-ES";

const BOOKING_PATH_RE =
  /^\/BookingFrameClient\/hotel\/[A-Za-z0-9]{6,64}\/[0-9A-Za-z-]{6,64}\/book\/rooms$/;

export type BookingEngineCheck =
  | { ok: true; base: string; host: string }
  | { ok: false; reason: "invalid_url" | "not_https" | "bad_host" | "bad_path" };

function hostAllowed(host: string): boolean {
  return BOOKING_LINK_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Valida la base que carga el super admin y la normaliza: sin query, sin
 * hash, sin barra final. Lo que no sea el motor de MiniHotel se rechaza.
 */
export function checkBookingEngineUrl(raw: unknown): BookingEngineCheck {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "invalid_url" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (url.username || url.password) return { ok: false, reason: "invalid_url" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostAllowed(host)) return { ok: false, reason: "bad_host" };
  const path = url.pathname.replace(/\/+$/, "");
  if (!BOOKING_PATH_RE.test(path)) return { ok: false, reason: "bad_path" };
  return { ok: true, base: `https://${host}${path}`, host };
}

export type BookingQuery = {
  from: string;
  to: string;
  adults: number;
  children?: number;
  babies?: number;
  roomType?: string | null;
  currency?: string | null;
  language?: string | null;
};

/**
 * Arma el enlace con la búsqueda. `null` si la base no es válida o las
 * fechas no lo son: mejor no mandar enlace que mandar uno roto.
 */
export function buildBookingLink(base: string, q: BookingQuery): string | null {
  const check = checkBookingEngineUrl(base);
  if (!check.ok) return null;
  if (!isIsoDate(q.from) || !isIsoDate(q.to)) return null;
  const url = new URL(check.base);
  url.searchParams.set("from", compactDate(q.from));
  url.searchParams.set("to", compactDate(q.to));
  url.searchParams.set("nAdults", String(Math.max(1, Math.trunc(q.adults))));
  if (q.children && q.children > 0) url.searchParams.set("nChilds", String(Math.trunc(q.children)));
  if (q.babies && q.babies > 0) url.searchParams.set("nBabies", String(Math.trunc(q.babies)));
  if (q.roomType && /^[\w.-]{1,32}$/.test(q.roomType)) url.searchParams.set("roomType", q.roomType);
  if (q.currency && /^[A-Z]{3}$/.test(q.currency)) url.searchParams.set("currency", q.currency);
  const language =
    q.language && /^[a-z]{2}-[A-Z]{2}$/.test(q.language) ? q.language : DEFAULT_BOOKING_LANGUAGE;
  url.searchParams.set("language", language);
  return url.toString();
}
