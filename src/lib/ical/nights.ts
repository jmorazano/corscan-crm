import { candidateOffsets, MAX_ALTERNATIVES } from "@/lib/minihotel/alternatives";
import { addDays, nightsBetween } from "@/lib/minihotel/dates";
import type { BusyRange } from "./parse";

/**
 * Disponibilidad por unidad a partir del snapshot de los calendarios (051).
 * Puro: recibe las unidades con sus rangos ocupados y el reloj inyectado.
 */

export type StayUnit = {
  id: string;
  name: string;
  capacity: number;
  description: string | null;
  bookingUrl: string | null;
  busy: BusyRange[];
  /** Última lectura BUENA del feed (null = nunca). */
  lastOkAt: Date | null;
};

export type StayRange = { from: string; to: string };

/** Una unidad sin lectura buena en este tiempo no se ofrece (spec §3). */
export const STALE_MS = 3 * 60 * 60 * 1000;
/** Más allá de esto el calendario del proveedor no es confiable. */
export const HORIZON_DAYS = 365;
export const MAX_STAY_NIGHTS = 60;

/** ¿Todas las noches `from ≤ n < to` están libres? (`to` = salida, exclusivo.) */
export function isFree(busy: readonly BusyRange[], from: string, to: string): boolean {
  // Dos rangos [a,b) y [c,d) se pisan si a < d y c < b. El que sale el 18
  // deja libre la entrada del 18.
  return !busy.some((r) => r.from < to && from < r.to);
}

export function isStale(unit: Pick<StayUnit, "lastOkAt">, now: Date, staleMs = STALE_MS): boolean {
  return !unit.lastOkAt || now.getTime() - unit.lastOkAt.getTime() > staleMs;
}

export type RangeProblem = "invalid" | "past" | "too_long" | "beyond";

/** Valida un rango pedido contra el día de hoy (de la empresa). */
export function rangeProblem(range: StayRange, today: string): RangeProblem | null {
  const nights = nightsBetween(range.from, range.to);
  if (nights <= 0) return "invalid";
  if (range.from < today) return "past";
  if (nights > MAX_STAY_NIGHTS) return "too_long";
  if (range.to > addDays(today, HORIZON_DAYS)) return "beyond";
  return null;
}

export type UnitsOutcome = {
  /** Libres y con capacidad suficiente: lo que se ofrece. */
  free: StayUnit[];
  /** Libres pero chicas para el grupo. */
  tooSmall: StayUnit[];
  /** Ocupadas en alguna noche del rango. */
  busy: StayUnit[];
  /** Sin lectura reciente: no se ofrecen ni se descartan. */
  unconfirmed: StayUnit[];
};

export function unitsFor(
  units: readonly StayUnit[],
  range: StayRange,
  guests: number | null,
  now: Date,
  staleMs = STALE_MS
): UnitsOutcome {
  const out: UnitsOutcome = { free: [], tooSmall: [], busy: [], unconfirmed: [] };
  for (const unit of units) {
    if (isStale(unit, now, staleMs)) {
      out.unconfirmed.push(unit);
      continue;
    }
    if (!isFree(unit.busy, range.from, range.to)) {
      out.busy.push(unit);
      continue;
    }
    if (guests !== null && unit.capacity < guests) out.tooSmall.push(unit);
    else out.free.push(unit);
  }
  return out;
}

export type AlternativeStay = StayRange & { units: StayUnit[] };

/**
 * Hasta 3 ventanas con la MISMA cantidad de noches, ±7 días, la más cercana
 * primero, nunca antes de hoy, con al menos una unidad libre que alcance.
 */
export function findAlternatives(
  units: readonly StayUnit[],
  range: StayRange,
  guests: number | null,
  today: string,
  now: Date,
  staleMs = STALE_MS
): AlternativeStay[] {
  const nights = nightsBetween(range.from, range.to);
  if (nights <= 0) return [];
  const out: AlternativeStay[] = [];
  for (const offset of candidateOffsets()) {
    if (out.length >= MAX_ALTERNATIVES) break;
    const from = addDays(range.from, offset);
    if (from < today) continue;
    const to = addDays(from, nights);
    if (to > addDays(today, HORIZON_DAYS)) continue;
    const { free } = unitsFor(units, { from, to }, guests, now, staleMs);
    if (free.length > 0) out.push({ from, to, units: free });
  }
  return out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/** Grilla de días para el panel: por día, ¿ocupado? (`from` incluido). */
export function dayGrid(busy: readonly BusyRange[], from: string, days: number): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    out.push(!isFree(busy, d, addDays(d, 1)));
  }
  return out;
}
