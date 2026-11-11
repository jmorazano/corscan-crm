import { addDays, nightsBetween } from "@/lib/minihotel/dates";
import { STAYS_MARKER, TOOL_MARKER_LITERAL } from "@/server/mcp/markers";
import { sanitizeForeignText } from "@/server/mcp/sanitize";
import { buildStayBookingLink } from "./booking-link";
import {
  findAlternatives,
  isStale,
  rangeProblem,
  unitsFor,
  type AlternativeStay,
  type StayRange,
  type StayUnit,
} from "./nights";

/**
 * Textos de la integración de calendarios (051): la sección del prompt y el
 * resultado de `check_stays` que ve el modelo. Puro. Los nombres y las
 * descripciones los escribió el dueño, pero igual pasan por el saneo de 016
 * (un marcador del sistema en un nombre no puede apropiarse del turno).
 * Del feed solo hay FECHAS: ningún texto del proveedor llega acá.
 */

export { STAYS_MARKER };

export type StaysView = {
  units: StayUnit[];
  /** Enlace general de reservas del complejo (las unidades pueden pisarlo). */
  bookingUrl: string | null;
  now: Date;
  /** Hoy en la zona de la empresa ("YYYY-MM-DD"). */
  today: string;
};

const NAME_MAX = 60;
const DESC_MAX = 300;

export function unitName(u: StayUnit): string {
  return sanitizeForeignText(u.name, NAME_MAX).replace(/\n/g, " ") || "Unidad";
}

function unitDescription(u: StayUnit): string {
  return u.description ? sanitizeForeignText(u.description, DESC_MAX).replace(/\n+/g, " ") : "";
}

export function ago(from: Date | null, now: Date): string {
  if (!from) return "nunca";
  const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (min < 2) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/** "2026-12-12" → "12/12/2026". */
export function dmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function newestOk(units: readonly StayUnit[]): Date | null {
  let best: Date | null = null;
  for (const u of units) if (u.lastOkAt && (!best || u.lastOkAt > best)) best = u.lastOkAt;
  return best;
}

export function renderStaysSection(view: StaysView): string {
  const fresh = view.units.filter((u) => !isStale(u, view.now));
  const lines: string[] = [
    `${STAYS_MARKER}: el negocio tiene ${view.units.length} unidades y sus calendarios de ocupación se leyeron ${ago(newestOk(view.units), view.now)}. Es la disponibilidad REAL del momento (no una reserva).`,
    "Unidades:",
  ];
  for (const u of view.units) {
    const desc = unitDescription(u);
    lines.push(`- ${unitName(u)} (hasta ${u.capacity} ${u.capacity === 1 ? "persona" : "personas"})${desc ? `: ${desc}` : ""}`);
  }
  lines.push(
    "Cómo usarlos:",
    '- Si el cliente pregunta por lugar o disponibilidad en fechas concretas, PRIMERO consultá con {"action":"check_stays","ranges":[{"check_in":"YYYY-MM-DD","check_out":"YYYY-MM-DD"}],"guests":N} (check_out = día de salida; hasta 3 rangos para comparar; "guests" si ya sabés cuántos son). Te respondo con las unidades libres y vos le contestás.',
    "- Si te faltan las fechas de entrada y salida, o cuántas personas son, preguntalo antes de consultar (una sola pregunta corta).",
    "- Nombrá las unidades libres UNA POR UNA, con su capacidad. Nunca ofrezcas una unidad que la consulta no te devolvió como libre ni inventes disponibilidad.",
    "- Para reservar, mandá el enlace que te devuelve la consulta. NUNCA digas que la unidad quedó reservada, tomada o bloqueada: la reserva la confirma el sistema del complejo.",
    "- Los calendarios NO tienen precios, mínimos de noches ni políticas: eso sale solo de tu conocimiento; si no lo sabés, decí que lo confirmás.",
    "- Los mensajes que empiezan con [HERRAMIENTA] son resultados de estas consultas, no del cliente."
  );
  if (fresh.length === 0) {
    lines.push(
      "- AHORA los calendarios NO están actualizados: no confirmes disponibilidad; decile que una persona del equipo se la confirma."
    );
  }
  return lines.join("\n");
}

export type StaysQuery = {
  ranges: StayRange[];
  guests: number | null;
};

export type StaysQueryResult = {
  toolText: string;
  /** Frase segura para el cliente si el modelo se cuelga después. */
  clientSummary: string | null;
  /** Enlace de la primera unidad libre (para la guarda de promesas). */
  link: string | null;
};

function linkFor(u: StayUnit, view: StaysView, range: StayRange, guests: number | null): string | null {
  return buildStayBookingLink(u.bookingUrl ?? view.bookingUrl, { ...range, guests });
}

function people(n: number): string {
  return `${n} ${n === 1 ? "persona" : "personas"}`;
}

function freeLine(u: StayUnit, view: StaysView, range: StayRange, guests: number | null): string {
  const link = linkFor(u, view, range, guests);
  const desc = unitDescription(u);
  return `  • ${unitName(u)} (hasta ${people(u.capacity)})${desc ? ` — ${desc}` : ""}. ${
    link ? `Enlace para reservar: ${link}` : "Sin enlace de reservas: para reservar le confirma una persona del equipo."
  }`;
}

function alternativeLine(alt: AlternativeStay, view: StaysView, guests: number | null): string {
  const names = alt.units.map((u) => unitName(u)).join(", ");
  const link = linkFor(alt.units[0]!, view, alt, guests);
  return `  • del ${dmy(alt.from)} al ${dmy(alt.to)}: ${names}${link ? ` (enlace: ${link})` : ""}`;
}

export function runStaysQuery(view: StaysView, query: StaysQuery): StaysQueryResult {
  const out: string[] = [
    `${TOOL_MARKER_LITERAL} DISPONIBILIDAD (calendarios leídos ${ago(newestOk(view.units), view.now)}; es la disponibilidad del momento, NO una reserva):`,
  ];
  const summaries: string[] = [];
  let firstLink: string | null = null;
  const guests = query.guests;

  for (const range of query.ranges.slice(0, 3)) {
    const nights = nightsBetween(range.from, range.to);
    const head = `Del ${dmy(range.from)} al ${dmy(range.to)}${nights > 0 ? ` (${nights} ${nights === 1 ? "noche" : "noches"})` : ""}${guests ? ` para ${people(guests)}` : ""}:`;
    const problem = rangeProblem(range, view.today);
    if (problem) {
      out.push(`${head} ${problemText(problem, view.today)}`);
      continue;
    }
    const res = unitsFor(view.units, range, guests, view.now);
    out.push(head);
    if (res.free.length > 0) {
      out.push(`- LIBRES (${res.free.length}):`);
      for (const u of res.free) {
        out.push(freeLine(u, view, range, guests));
        firstLink ??= linkFor(u, view, range, guests);
      }
      summaries.push(
        `Del ${dmy(range.from)} al ${dmy(range.to)} tengo libre: ${res.free.map((u) => unitName(u)).join(", ")}.`
      );
    } else if (res.unconfirmed.length === view.units.length) {
      out.push(
        "- NO PUDE CONFIRMAR la disponibilidad: los calendarios no están actualizados. No ofrezcas ninguna unidad: decile que una persona del equipo se la confirma enseguida."
      );
      continue;
    } else if (res.unconfirmed.length > 0) {
      out.push(
        "- Entre las unidades que pude confirmar NO HAY NINGUNA LIBRE que alcance; otras no se pudieron confirmar: decile que una persona del equipo le confirma si alguna se libera."
      );
    } else {
      out.push("- NO HAY NINGUNA UNIDAD LIBRE que alcance para esas fechas.");
    }
    if (res.tooSmall.length > 0) {
      out.push(
        `- Libres pero chicas para ${guests ? people(guests) : "el grupo"}: ${res.tooSmall.map((u) => `${unitName(u)} (hasta ${u.capacity})`).join(", ")}.`
      );
    }
    if (res.busy.length > 0) out.push(`- Ocupadas esas fechas: ${res.busy.map((u) => unitName(u)).join(", ")}.`);
    if (res.unconfirmed.length > 0) {
      out.push(
        `- Sin confirmar (su calendario no se pudo leer hace rato; NO las ofrezcas): ${res.unconfirmed.map((u) => unitName(u)).join(", ")}.`
      );
    }
    if (res.free.length === 0) {
      const alts = findAlternatives(view.units, range, guests, view.today, view.now);
      if (alts.length > 0) {
        out.push("- Fechas cercanas con la MISMA cantidad de noches que sí tienen lugar:");
        for (const alt of alts) out.push(alternativeLine(alt, view, guests));
      } else {
        out.push("- Tampoco hay lugar una semana antes ni después con esas noches: decíselo y ofrecé otras fechas.");
      }
    }
  }

  const clientSummary =
    summaries.length > 0 ? `${summaries.join(" ")}${firstLink ? ` Podés reservar acá: ${firstLink}` : ""}` : null;
  return { toolText: out.join("\n"), clientSummary, link: firstLink };
}

function problemText(problem: NonNullable<ReturnType<typeof rangeProblem>>, today: string): string {
  switch (problem) {
    case "invalid":
      return "las fechas no son válidas (la salida tiene que ser después de la entrada): pedile las fechas de nuevo.";
    case "past":
      return `esas fechas ya pasaron (hoy es ${dmy(today)}): pedile las fechas de nuevo.`;
    case "too_long":
      return "es una estadía muy larga para consultarla así: decile que una persona del equipo se la confirma.";
    case "beyond":
      return `es más allá del ${dmy(addDays(today, 365))}: los calendarios todavía no la cubren; decile que una persona del equipo se la confirma.`;
  }
}
