import { addDays, isIsoDate } from "@/lib/minihotel/dates";
import { localDateKey } from "@/lib/time";

/**
 * Parser ACOTADO de iCalendar (RFC 5545) para los calendarios de
 * disponibilidad que exporta un proveedor de alquileres (051, Airbnb).
 *
 * Solo extrae QUÉ NOCHES están ocupadas. Todo el texto de los eventos
 * (`SUMMARY`, `DESCRIPTION`: Airbnb pone ahí la URL de la reserva y los
 * últimos 4 dígitos del teléfono del huésped) se descarta acá mismo y nunca
 * sale de esta función (constitución 1.16.0, cat. 7 (f)).
 *
 * Convención de rangos: `from` = primera noche, `to` = día de SALIDA
 * (exclusivo), igual que `DTEND` de un evento de día completo y que el `to`
 * de MiniHotel (028).
 */

export type BusyRange = { from: string; to: string };

export type IcalParseError = "not_calendar" | "unsupported" | "too_many_events";

export type IcalParseResult =
  | { ok: true; busy: BusyRange[]; horizonTo: string | null; events: number }
  | { ok: false; code: IcalParseError };

export const MAX_EVENTS = 2000;
/** Un evento más largo que esto es un bloqueo «para siempre»: se recorta. */
const MAX_EVENT_DAYS = 800;

type Prop = { name: string; params: Record<string, string>; value: string };

/** RFC 5545 §3.1: una línea que empieza con espacio o tab continúa la anterior. */
export function unfoldLines(text: string): string[] {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseProp(line: string): Prop | null {
  const colon = indexOfUnquoted(line, ":");
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(";");
  const name = (parts[0] ?? "").trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq <= 0) continue;
    params[p.slice(0, eq).trim().toUpperCase()] = p.slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
  return { name, params, value: value.trim() };
}

function indexOfUnquoted(s: string, ch: string): number {
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quoted = !quoted;
    else if (c === ch && !quoted) return i;
  }
  return -1;
}

/**
 * Valor de `DTSTART`/`DTEND` → día local "YYYY-MM-DD".
 * - `VALUE=DATE` (o 8 dígitos): fecha flotante, sin conversión.
 * - Fecha-hora con `Z`: instante UTC → día en la zona de la empresa.
 * - Fecha-hora con `TZID` o flotante: el día escrito (el proveedor ya la
 *   expresó en la hora del alojamiento).
 */
export function dayOf(prop: Prop, tz: string): string | null {
  const v = prop.value;
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (date) {
    const iso = `${date[1]}-${date[2]}-${date[3]}`;
    return isIsoDate(iso) ? iso : null;
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!dt) return null;
  const iso = `${dt[1]}-${dt[2]}-${dt[3]}`;
  if (!isIsoDate(iso)) return null;
  if (dt[7] === "Z") {
    const at = new Date(
      Date.UTC(Number(dt[1]), Number(dt[2]) - 1, Number(dt[3]), Number(dt[4]), Number(dt[5]), Number(dt[6]))
    );
    try {
      return localDateKey(tz, at);
    } catch {
      return iso;
    }
  }
  return iso;
}

/** `P3D`, `P1W`, `PT24H` → días enteros (redondeo hacia arriba); otra cosa → null. */
export function durationDays(raw: string): number | null {
  const m = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(raw.trim());
  if (!m || raw.trim() === "P" || raw.trim() === "PT") return null;
  const weeks = Number(m[1] ?? 0);
  const days = Number(m[2] ?? 0);
  const seconds = Number(m[3] ?? 0) * 3600 + Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0);
  return weeks * 7 + days + Math.ceil(seconds / 86_400);
}

/** Ordena y fusiona rangos que se tocan o se pisan. */
export function mergeRanges(ranges: BusyRange[]): BusyRange[] {
  const sorted = ranges
    .filter((r) => r.from < r.to)
    .slice()
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: BusyRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) {
      if (r.to > last.to) last.to = r.to;
    } else {
      out.push({ from: r.from, to: r.to });
    }
  }
  return out;
}

export function parseIcal(
  text: string,
  options: { tz: string; maxEvents?: number }
): IcalParseResult {
  const maxEvents = options.maxEvents ?? MAX_EVENTS;
  const lines = unfoldLines(text);
  const first = lines.find((l) => l.trim() !== "");
  if (!first || first.trim().toUpperCase() !== "BEGIN:VCALENDAR") return { ok: false, code: "not_calendar" };
  if (!lines.some((l) => l.trim().toUpperCase() === "END:VCALENDAR")) return { ok: false, code: "not_calendar" };

  const busy: BusyRange[] = [];
  let events = 0;
  let inEvent = false;
  let nested = 0; // VALARM y otros dentro del VEVENT
  let start: string | null = null;
  let end: string | null = null;
  let duration: number | null = null;
  let cancelled = false;
  let transparent = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const upper = trimmed.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      if (inEvent) return { ok: false, code: "not_calendar" };
      inEvent = true;
      nested = 0;
      start = end = null;
      duration = null;
      cancelled = transparent = false;
      continue;
    }
    if (upper === "END:VEVENT") {
      if (!inEvent) return { ok: false, code: "not_calendar" };
      inEvent = false;
      events++;
      if (events > maxEvents) return { ok: false, code: "too_many_events" };
      if (cancelled || transparent || !start) continue;
      let to = end;
      if (!to && duration !== null) to = addDays(start, Math.max(1, duration));
      // Evento de un día sin fin (RFC 5545 §3.6.1): ocupa esa noche.
      if (!to || to <= start) to = addDays(start, 1);
      const maxTo = addDays(start, MAX_EVENT_DAYS);
      busy.push({ from: start, to: to > maxTo ? maxTo : to });
      continue;
    }
    if (!inEvent) continue;
    if (upper.startsWith("BEGIN:")) {
      nested++;
      continue;
    }
    if (upper.startsWith("END:")) {
      nested = Math.max(0, nested - 1);
      continue;
    }
    if (nested > 0) continue;
    const prop = parseProp(trimmed);
    if (!prop) continue;
    switch (prop.name) {
      case "DTSTART":
        start = dayOf(prop, options.tz);
        break;
      case "DTEND":
        end = dayOf(prop, options.tz);
        break;
      case "DURATION":
        duration = durationDays(prop.value);
        break;
      case "STATUS":
        cancelled = prop.value.toUpperCase() === "CANCELLED";
        break;
      case "TRANSP":
        transparent = prop.value.toUpperCase() === "TRANSPARENT";
        break;
      case "RRULE":
      case "RDATE":
        // Airbnb no las usa; expandirlas mal sería ofrecer noches ocupadas.
        return { ok: false, code: "unsupported" };
      default:
        // SUMMARY, DESCRIPTION, UID, LOCATION…: se descartan a propósito.
        break;
    }
  }
  if (inEvent) return { ok: false, code: "not_calendar" };

  const merged = mergeRanges(busy);
  const horizonTo = merged.length > 0 ? merged[merged.length - 1]!.to : null;
  return { ok: true, busy: merged, horizonTo, events };
}
