/**
 * Zona horaria sin dependencias (research D5): Node 22 trae ICU completo,
 * así que `Intl.DateTimeFormat` alcanza para convertir hora local del
 * negocio ↔ UTC, incluidos los bordes de horario de verano.
 */

export type LocalParts = {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number;
  weekday: number; // 0 = domingo … 6 = sábado
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Partes locales de un instante en la zona dada. */
export function toLocalParts(timeZone: string, at: Date): LocalParts {
  const parts = formatter(timeZone).formatToParts(at);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/** Offset (local − UTC) en minutos de la zona en el instante dado. */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const p = toLocalParts(timeZone, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
  const truncated = Math.floor(at.getTime() / 60000) * 60000;
  return Math.round((asUtc - truncated) / 60000);
}

/**
 * Hora local (zona del negocio) → instante UTC. Doble iteración para que
 * un cambio de horario entre la estimación y el resultado no corra la hora.
 */
export function zonedToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = tzOffsetMinutes(timeZone, new Date(guess));
  const utc1 = guess - offset1 * 60000;
  const offset2 = tzOffsetMinutes(timeZone, new Date(utc1));
  return new Date(offset2 === offset1 ? utc1 : guess - offset2 * 60000);
}

/** "YYYY-MM-DD" de la fecha local del instante. */
export function localDateKey(timeZone: string, at: Date): string {
  const p = toLocalParts(timeZone, at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "YYYY-MM-DDTHH:MM" local del instante (lo que el agente lee/escribe). */
export function localDateTimeKey(timeZone: string, at: Date): string {
  const p = toLocalParts(timeZone, at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Parsea "YYYY-MM-DD" (fecha calendario, sin zona). */
export function parseDateKey(
  s: string
): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Rechaza 31 de febrero y similares.
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** Parsea "YYYY-MM-DDTHH:MM" (hora local, sin zona). Tolera segundos. */
export function parseLocalDateTime(
  s: string
): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const date = parseDateKey(m[1]!);
  if (!date) return null;
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (hour > 23 || minute > 59) return null;
  return { ...date, hour, minute };
}

/** Suma días calendario a una clave "YYYY-MM-DD". */
export function addDaysToKey(key: string, days: number): string {
  const d = parseDateKey(key);
  if (!d) throw new Error(`fecha inválida: ${key}`);
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const WEEKDAY_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const MONTH_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

export const WEEKDAY_ES_LONG = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

/** Etiqueta breve en español: "lun 7 sep 09:00". */
export function formatLocalLabel(timeZone: string, at: Date): string {
  const p = toLocalParts(timeZone, at);
  return `${WEEKDAY_ES[p.weekday]} ${p.day} ${MONTH_ES[p.month - 1]} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Etiqueta larga: "lunes 7 de septiembre a las 09:00". */
export function formatLocalLong(timeZone: string, at: Date): string {
  const p = toLocalParts(timeZone, at);
  const day = WEEKDAY_ES_LONG[p.weekday]!.toLowerCase();
  const months = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  return `${day} ${p.day} de ${months[p.month - 1]} a las ${pad(p.hour)}:${pad(p.minute)}`;
}

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
