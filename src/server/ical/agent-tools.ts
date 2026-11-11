import { normalizeDate } from "@/lib/minihotel/dates";
import type { StayRange, StayUnit } from "@/lib/ical/nights";
import { renderStaysSection, runStaysQuery, type StaysQueryResult, type StaysView } from "@/lib/ical/render";
import { localDateKey } from "@/lib/time";
import { organizationTimezone } from "./feed";
import { getSettingsRow, listUnitRows } from "./integration";

/**
 * Puente agente ↔ calendarios de las unidades (051). Mismo contrato de tres
 * piezas que Mercado Libre (025): `loadStaysContext` → sección del prompt →
 * `executeStaysAction`. El turno NUNCA sale a la red (ni dentro ni fuera
 * del Laboratorio): lee el snapshot que deja el ticker. Nada de acá lanza
 * hacia el pipeline.
 */

export type StaysContext = { view: StaysView };

export type StaysAction = {
  action: "check_stays";
  check_in?: string;
  check_out?: string;
  ranges?: { check_in?: string; check_out?: string }[];
  guests?: number;
};

/**
 * `null` = el agente atiende como antes: sin unidades, con el switch
 * apagado o sin ninguna lectura buena todavía (no hay nada que ofrecer).
 */
export async function loadStaysContext(
  organizationId: string,
  options: { now?: Date } = {}
): Promise<StaysContext | null> {
  const settings = await getSettingsRow(organizationId);
  if (settings && !settings.agentEnabled) return null;
  const rows = await listUnitRows(organizationId);
  if (rows.length === 0 || !rows.some((r) => r.lastOkAt)) return null;
  const now = options.now ?? new Date();
  const tz = await organizationTimezone(organizationId);
  let today: string;
  try {
    today = localDateKey(tz, now);
  } catch {
    today = now.toISOString().slice(0, 10);
  }
  const units: StayUnit[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    capacity: r.capacity,
    description: r.description,
    bookingUrl: r.bookingUrl,
    busy: r.busyRanges,
    lastOkAt: r.lastOkAt,
  }));
  return { view: { units, bookingUrl: settings?.bookingUrl ?? null, now, today } };
}

export function renderStaysPromptSection(ctx: StaysContext): string {
  return renderStaysSection(ctx.view);
}

/** Rangos que pidió el modelo, normalizados; los incompletos se descartan. */
export function rangesOf(action: StaysAction): StayRange[] {
  const raw = action.ranges && action.ranges.length > 0 ? action.ranges : [{ check_in: action.check_in, check_out: action.check_out }];
  const out: StayRange[] = [];
  for (const r of raw.slice(0, 3)) {
    const from = normalizeDate(r.check_in);
    const to = normalizeDate(r.check_out);
    if (from && to) out.push({ from, to });
  }
  return out;
}

export function executeStaysAction(ctx: StaysContext, action: StaysAction): StaysQueryResult {
  try {
    const ranges = rangesOf(action);
    if (ranges.length === 0) {
      return {
        toolText:
          "[HERRAMIENTA] Para consultar la disponibilidad necesito la fecha de ENTRADA y la de SALIDA (YYYY-MM-DD). Preguntáselas al cliente.",
        clientSummary: null,
        link: null,
      };
    }
    const guests = typeof action.guests === "number" && action.guests > 0 ? action.guests : null;
    return runStaysQuery(ctx.view, { ranges, guests });
  } catch (err) {
    console.error("[agente] consulta de calendarios falló:", err instanceof Error ? err.message : err);
    return {
      toolText:
        "[HERRAMIENTA] NO PUDE CONSULTAR LA DISPONIBILIDAD en este momento. No inventes lugar: decile que una persona del equipo se la confirma enseguida.",
      clientSummary: null,
      link: null,
    };
  }
}
