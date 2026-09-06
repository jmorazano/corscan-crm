import {
  addDaysToKey,
  formatLocalLabel,
  localDateKey,
  parseDateKey,
  toLocalParts,
  zonedToUtc,
} from "@/lib/time";
import { toMinutes, type WeeklyHours, type WeekdayKey } from "@/server/calendar/rules";

/**
 * Cálculo PURO de huecos libres (research D5): reglas + zona + `now` +
 * intervalos ocupados → huecos en UTC con etiqueta local. Determinista,
 * sin red, sin BD. Es la única fuente de verdad de "qué se puede ofrecer":
 * la reserva valida contra ESTA grilla (el modelo jamás decide validez).
 */

export type Interval = { start: Date; end: Date };
export type Slot = Interval & { label: string; localKey: string };

export type SlotRules = {
  slotMinutes: number;
  bufferMinutes: number;
  minLeadHours: number;
  horizonDays: number;
  weeklyHours: WeeklyHours;
};

export type ComputeSlotsInput = {
  rules: SlotRules;
  timezone: string;
  now: Date;
  busy: Interval[];
  /** Primer día local a considerar ("YYYY-MM-DD"); default: hoy local. */
  fromDate?: string;
  /** Cantidad de días locales a recorrer desde fromDate (acotado al horizonte). */
  days?: number;
  /** Tope de huecos devueltos. */
  limit?: number;
};

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime();
}

export function computeFreeSlots(input: ComputeSlotsInput): Slot[] {
  const { rules, timezone, now, busy } = input;
  const earliest = now.getTime() + rules.minLeadHours * 3_600_000;
  const horizonEnd = now.getTime() + rules.horizonDays * 86_400_000;
  const todayKey = localDateKey(timezone, now);
  const startKey = input.fromDate && parseDateKey(input.fromDate) ? input.fromDate : todayKey;
  const maxDays = Math.max(1, Math.min(input.days ?? rules.horizonDays, rules.horizonDays + 1));
  const step = (rules.slotMinutes + rules.bufferMinutes) * 60_000;
  const slotMs = rules.slotMinutes * 60_000;
  const limit = input.limit ?? Number.POSITIVE_INFINITY;

  const out: Slot[] = [];
  for (let i = 0; i < maxDays && out.length < limit; i++) {
    const key = addDaysToKey(startKey, i);
    const date = parseDateKey(key)!;
    // Día de semana LOCAL: el mediodía local evita ambigüedades de DST.
    const noon = zonedToUtc(timezone, date.year, date.month, date.day, 12, 0);
    const weekday = toLocalParts(timezone, noon).weekday;
    const ranges = rules.weeklyHours[String(weekday) as WeekdayKey] ?? [];
    for (const [from, to] of ranges) {
      const fromMin = toMinutes(from);
      const toMin = toMinutes(to);
      const rangeStart = zonedToUtc(
        timezone,
        date.year,
        date.month,
        date.day,
        Math.floor(fromMin / 60),
        fromMin % 60
      ).getTime();
      const rangeEnd = zonedToUtc(
        timezone,
        date.year,
        date.month,
        date.day,
        Math.floor(toMin / 60),
        toMin % 60
      ).getTime();
      for (let s = rangeStart; s + slotMs <= rangeEnd; s += step) {
        if (out.length >= limit) break;
        if (s < earliest) continue;
        if (s + slotMs > horizonEnd) break;
        const slot: Interval = { start: new Date(s), end: new Date(s + slotMs) };
        if (busy.some((b) => overlaps(slot, b))) continue;
        out.push({
          ...slot,
          label: formatLocalLabel(timezone, slot.start),
          localKey: key,
        });
      }
    }
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

/** ¿`start` es exactamente un hueco libre de la grilla? (validación de reserva) */
export function isSlotAvailable(
  start: Date,
  input: Omit<ComputeSlotsInput, "fromDate" | "days" | "limit">
): boolean {
  const key = localDateKey(input.timezone, start);
  const slots = computeFreeSlots({ ...input, fromDate: key, days: 1 });
  return slots.some((s) => s.start.getTime() === start.getTime());
}
