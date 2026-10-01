import { addDays } from "./dates";
import type { BulkDay, BulkRoom } from "./responses";

/**
 * Fechas alternativas (028, US3). PURO, calcado del espíritu de
 * `src/server/calendar/slots.ts`: recibe el Bulk ARI ya leído y devuelve
 * ventanas candidatas, sin red ni base.
 *
 * Reglas del alcance acordado con el dueño:
 * - la MISMA cantidad de noches que pidió el huésped;
 * - dentro de los 7 días anteriores o posteriores a la entrada pedida;
 * - nunca en el pasado;
 * - respetando lo que MiniHotel restringe por día: unidades libres, cierre,
 *   cierre a la llegada (día de entrada), cierre a la salida (día de salida)
 *   y mínimo de noches del día de entrada;
 * - hasta 3, las más cercanas primero.
 *
 * El Bulk ARI no conoce la ocupación (adultos/niños) ni los precios finales:
 * cada ventana se CONFIRMA después con un Immediate ARI antes de ofrecerla.
 */

export const ALTERNATIVE_SPREAD_DAYS = 7;
export const MAX_ALTERNATIVES = 3;

export type StayWindow = { from: string; to: string };
export type AlternativeWindow = StayWindow & { roomCodes: string[] };

/** -1, +1, -2, +2, …: lo más cercano primero. */
export function candidateOffsets(spread: number = ALTERNATIVE_SPREAD_DAYS): number[] {
  const out: number[] = [];
  for (let d = 1; d <= spread; d++) out.push(-d, d);
  return out;
}

/**
 * Período del Bulk ARI que cubre todas las candidatas: desde la entrada más
 * temprana posible (nunca antes de hoy) hasta la SALIDA de la más tardía,
 * porque el cierre a la salida se mira en ese día.
 */
export function bulkRangeFor(
  requested: StayWindow,
  nights: number,
  today: string,
  spread: number = ALTERNATIVE_SPREAD_DAYS
): StayWindow {
  const earliest = addDays(requested.from, -spread);
  return {
    from: earliest < today ? today : earliest,
    to: addDays(requested.from, spread + nights),
  };
}

function fits(days: Map<string, BulkDay>, from: string, to: string, nights: number): boolean {
  for (let k = 0; k < nights; k++) {
    const day = days.get(addDays(from, k));
    if (!day || day.available <= 0 || day.closed) return false;
  }
  const arrival = days.get(from);
  if (!arrival || arrival.closedArrival) return false;
  if (arrival.minNights !== null && arrival.minNights > nights) return false;
  const departure = days.get(to);
  if (departure?.closedDeparture) return false;
  return true;
}

export function findAlternativeWindows(input: {
  rooms: readonly BulkRoom[];
  requested: StayWindow;
  nights: number;
  today: string;
  spread?: number;
  max?: number;
  /** Si se conoce, solo estos tipos (p. ej. los que alcanzan para el grupo). */
  roomCodes?: ReadonlySet<string> | null;
}): AlternativeWindow[] {
  const spread = input.spread ?? ALTERNATIVE_SPREAD_DAYS;
  const max = input.max ?? MAX_ALTERNATIVES;
  if (input.nights <= 0 || max <= 0) return [];

  const indexed = input.rooms
    .filter((r) => !input.roomCodes || input.roomCodes.has(r.code))
    .map((r) => ({ code: r.code, days: new Map(r.days.map((d) => [d.date, d])) }));

  const found: AlternativeWindow[] = [];
  for (const offset of candidateOffsets(spread)) {
    const from = addDays(input.requested.from, offset);
    if (from < input.today) continue;
    const to = addDays(from, input.nights);
    const roomCodes = indexed.filter((r) => fits(r.days, from, to, input.nights)).map((r) => r.code);
    if (roomCodes.length > 0) found.push({ from, to, roomCodes });
    if (found.length >= max) break;
  }
  return found.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}
