/**
 * Fechas de calendario "YYYY-MM-DD" para MiniHotel (028). Puras y en UTC
 * a propósito: son fechas de estadía (noches), no instantes — mezclarlas
 * con la zona horaria del proceso corre un día las madrugadas.
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿"YYYY-MM-DD" es una fecha REAL? (rechaza 2026-02-31). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function toUtc(iso: string): number {
  const m = ISO_DATE_RE.exec(iso);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtc(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** `iso` + `days` (puede ser negativo). */
export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * 86_400_000);
}

/** Noches entre entrada y salida (0 o negativo si el rango es inválido). */
export function nightsBetween(from: string, to: string): number {
  const a = toUtc(from);
  const b = toUtc(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** "2026-10-10" → "20261010" (formato del motor de reservas y de Bulk ARI). */
export function compactDate(iso: string): string {
  return iso.replaceAll("-", "");
}

/** "20261010" → "2026-10-10"; cualquier otra cosa → `null`. */
export function expandCompactDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return isIsoDate(iso) ? iso : null;
}

/**
 * Lo que escribe el modelo → "YYYY-MM-DD": ISO, ISO con hora, y `dd/mm/yyyy`
 * o `dd-mm-yyyy` (la forma en que un argentino dicta la fecha).
 */
export function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(value);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isIsoDate(candidate) ? candidate : null;
  }
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (dmy) {
    const candidate = `${dmy[3]}-${String(Number(dmy[2])).padStart(2, "0")}-${String(
      Number(dmy[1])
    ).padStart(2, "0")}`;
    return isIsoDate(candidate) ? candidate : null;
  }
  return null;
}
