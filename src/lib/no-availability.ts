/**
 * «No hay lugar» como RESPUESTA, no como fallo (incidente 14-oct-2026, Altos
 * de Calamuchita).
 *
 * El cliente pidió casa para «8, 10 o 6» del 21 al 23 de noviembre. El agente
 * buscó para 6 y para 8 —las dos vacías—, quiso una tercera búsqueda, se quedó
 * sin consultas y el pipeline mandó la frase cableada «Estoy consultando la
 * disponibilidad y te confirmo en un ratito» + atención humana. El cliente
 * esperó media hora una respuesta que el sistema ya tenía: no había nada.
 *
 * PURO: arma la frase con datos propios (fechas normalizadas y cantidades
 * que mandó el agente), nunca con texto del proveedor. Sale TAL CUAL a un
 * cliente real, así que no lleva importes, enlaces ni promesas.
 */

export type NoAvailabilitySearch = {
  /** YYYY-MM-DD, o "" si no se supo. */
  checkIn: string;
  checkOut: string;
  guests: number | null;
  /** Hubo tipo, localidad o características: «no hay» es «no hay CON ESO». */
  filtered: boolean;
};

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "21/11" */
function shortDate(iso: string): string {
  const m = ISO_DATE_RE.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
}

/** [6, 8] → "6 ni para 8" · [6, 8, 10] → "6, 8 ni para 10". */
function guestsList(guests: number[]): string {
  if (guests.length === 1) return `${guests[0]}`;
  const last = guests[guests.length - 1];
  return `${guests.slice(0, -1).join(", ")} ni para ${last}`;
}

/**
 * La frase para el cliente, o `null` si no hubo ninguna búsqueda vacía.
 * Agrupa por rango de fechas: lo normal es UN rango con varias cantidades.
 */
export function noAvailabilityReply(searches: NoAvailabilitySearch[]): string | null {
  if (searches.length === 0) return null;

  const byRange = new Map<string, { checkIn: string; checkOut: string; guests: Set<number> }>();
  const filtered = searches.some((s) => s.filtered);
  for (const s of searches) {
    const key = `${s.checkIn}|${s.checkOut}`;
    const entry = byRange.get(key) ?? { checkIn: s.checkIn, checkOut: s.checkOut, guests: new Set<number>() };
    if (s.guests !== null && Number.isFinite(s.guests) && s.guests > 0) entry.guests.add(s.guests);
    byRange.set(key, entry);
  }

  const parts = [...byRange.values()].map((r) => {
    const when =
      r.checkIn && r.checkOut
        ? `del ${shortDate(r.checkIn)} al ${shortDate(r.checkOut)}`
        : "para esas fechas";
    const guests = [...r.guests].sort((a, b) => a - b);
    const who = guests.length > 0 ? ` para ${guestsList(guests)} personas` : "";
    return `${when}${who}`;
  });

  const ranges = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} ni ${parts[parts.length - 1]}`;
  const otherDates = byRange.size > 1 ? "otras fechas" : "otras fechas cercanas";
  const what = filtered ? " con lo que buscás" : "";
  return `Lamentablemente no tengo disponibilidad${what} ${ranges}. ¿Querés que te busque ${otherDates}?`;
}
