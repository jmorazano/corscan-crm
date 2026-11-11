/**
 * Estado en memoria del ical-mock (051): calendarios de Airbnb simulados
 * para el self-test. Solo responde tras el gate de mocks; un reinicio lo
 * borra. Por defecto un id desconocido devuelve un calendario VACÍO (todo
 * libre), como una publicación sin reservas.
 */

export type MockRange = { from: string; to: string };

type State = {
  busy: Map<string, MockRange[]>;
  /** id → status HTTP del próximo pedido (404, 403, 500…). */
  failNext: Map<string, number>;
  /** id → status HTTP de TODOS los pedidos hasta que se limpie. */
  failAlways: Map<string, number>;
  garbageNext: Set<string>;
  redirectNext: Set<string>;
  /** Reservas con `DESCRIPTION` y teléfono (para probar que se descartan). */
  guestData: boolean;
  delayMs: number;
  hits: Map<string, number>;
};

const g = globalThis as unknown as { __icalMock?: State };

function fresh(): State {
  return {
    busy: new Map(),
    failNext: new Map(),
    failAlways: new Map(),
    garbageNext: new Set(),
    redirectNext: new Set(),
    guestData: false,
    delayMs: 0,
    hits: new Map(),
  };
}

export function getIcalMockState(): State {
  return (g.__icalMock ??= fresh());
}

export function resetIcalMockState(): void {
  g.__icalMock = fresh();
}

const compact = (iso: string) => iso.replaceAll("-", "");

export function renderMockFeed(id: string, s: State): string {
  const lines = ["BEGIN:VCALENDAR", "PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN", "CALSCALE:GREGORIAN", "VERSION:2.0"];
  for (const [i, r] of (s.busy.get(id) ?? []).entries()) {
    lines.push(
      "BEGIN:VEVENT",
      "DTSTAMP:20261111T194057Z",
      `DTSTART;VALUE=DATE:${compact(r.from)}`,
      `DTEND;VALUE=DATE:${compact(r.to)}`,
      ...(s.guestData && i % 2 === 0
        ? [
            "SUMMARY:Reserved",
            "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMMOCK123\\nPhone Num",
            " ber (Last 4 Digits): 9876",
          ]
        : ["SUMMARY:Airbnb (Not available)"]),
      `UID:mock-${id}-${i}@airbnb.com`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
