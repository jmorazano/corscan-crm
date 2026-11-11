import { describe, expect, it } from "vitest";
import { buildStayBookingLink, checkBookingUrl } from "@/lib/ical/booking-link";
import { checkAirbnbIcalUrl } from "@/lib/ical/airbnb-url";
import { dayGrid, findAlternatives, isFree, rangeProblem, unitsFor, type StayUnit } from "@/lib/ical/nights";
import { renderStaysSection, runStaysQuery, STAYS_MARKER } from "@/lib/ical/render";

const NOW = new Date("2026-11-11T15:00:00Z");
const TODAY = "2026-11-11";
const FRESH = new Date("2026-11-11T14:50:00Z");
const OLD = new Date("2026-11-11T10:00:00Z");

function unit(id: string, capacity: number, busy: StayUnit["busy"], extra: Partial<StayUnit> = {}): StayUnit {
  return {
    id,
    name: `Cabaña ${id}`,
    capacity,
    description: null,
    bookingUrl: null,
    busy,
    lastOkAt: FRESH,
    ...extra,
  };
}

describe("isFree / unitsFor", () => {
  const busy = [{ from: "2026-12-11", to: "2026-12-18" }];
  it("el día de salida de uno es el de entrada de otro", () => {
    expect(isFree(busy, "2026-12-18", "2026-12-20")).toBe(true);
    expect(isFree(busy, "2026-12-08", "2026-12-11")).toBe(true);
    expect(isFree(busy, "2026-12-17", "2026-12-19")).toBe(false);
    expect(isFree(busy, "2026-12-01", "2026-12-30")).toBe(false);
  });

  it("separa libres, chicas, ocupadas y sin confirmar", () => {
    const units = [
      unit("Abeto", 4, []),
      unit("Pino", 2, []),
      unit("Roble", 6, busy),
      unit("Coihue", 6, [], { lastOkAt: OLD }),
    ];
    const r = unitsFor(units, { from: "2026-12-12", to: "2026-12-15" }, 4, NOW);
    expect(r.free.map((u) => u.id)).toEqual(["Abeto"]);
    expect(r.tooSmall.map((u) => u.id)).toEqual(["Pino"]);
    expect(r.busy.map((u) => u.id)).toEqual(["Roble"]);
    expect(r.unconfirmed.map((u) => u.id)).toEqual(["Coihue"]);
  });

  it("sin cantidad de huéspedes no descarta por capacidad", () => {
    const r = unitsFor([unit("Pino", 2, [])], { from: "2026-12-12", to: "2026-12-15" }, null, NOW);
    expect(r.free).toHaveLength(1);
  });
});

describe("rangeProblem", () => {
  it("valida contra hoy", () => {
    expect(rangeProblem({ from: "2026-12-12", to: "2026-12-12" }, TODAY)).toBe("invalid");
    expect(rangeProblem({ from: "2026-11-10", to: "2026-11-12" }, TODAY)).toBe("past");
    expect(rangeProblem({ from: "2026-11-11", to: "2027-03-01" }, TODAY)).toBe("too_long");
    expect(rangeProblem({ from: "2027-12-01", to: "2027-12-03" }, TODAY)).toBe("beyond");
    expect(rangeProblem({ from: "2026-11-11", to: "2026-11-12" }, TODAY)).toBeNull();
  });
});

describe("findAlternatives", () => {
  it("misma cantidad de noches, ±7 días, las más cercanas, nunca antes de hoy", () => {
    const units = [unit("Abeto", 4, [{ from: "2026-11-12", to: "2026-11-20" }])];
    const alts = findAlternatives(units, { from: "2026-11-14", to: "2026-11-16" }, 2, TODAY, NOW);
    expect(alts.map((a) => [a.from, a.to])).toEqual([
      ["2026-11-20", "2026-11-22"],
      ["2026-11-21", "2026-11-23"],
    ]);
    // Antes de hoy no ofrece: del 12 para atrás está ocupado o pasado.
    expect(alts.every((a) => a.from >= TODAY)).toBe(true);
  });
  it("como mucho 3", () => {
    const alts = findAlternatives(
      [unit("Abeto", 4, [{ from: "2026-12-10", to: "2026-12-13" }])],
      { from: "2026-12-10", to: "2026-12-12" },
      2,
      TODAY,
      NOW
    );
    expect(alts).toHaveLength(3);
    expect(alts[0]!.units[0]!.id).toBe("Abeto");
  });
});

describe("dayGrid", () => {
  it("marca los días ocupados", () => {
    expect(dayGrid([{ from: "2026-11-12", to: "2026-11-14" }], "2026-11-11", 4)).toEqual([false, true, true, false]);
  });
});

describe("checkAirbnbIcalUrl", () => {
  it("acepta los dominios de país y saca el id y la llave", () => {
    const r = checkAirbnbIcalUrl(
      "https://www.airbnb.ae/calendar/ical/1514772510655280107.ics?t=cfda2456cb0e4f809b6d8127c3edad13"
    );
    expect(r).toMatchObject({ ok: true, listingId: "1514772510655280107", host: "www.airbnb.ae", tokenLast4: "ad13" });
    for (const host of ["airbnb.com", "www.airbnb.com.ar", "es.airbnb.com".replace("es.", ""), "www.airbnb.co.uk", "airbnb.es"]) {
      expect(checkAirbnbIcalUrl(`https://${host}/calendar/ical/123456.ics?s=abcd1234`).ok).toBe(true);
    }
  });

  it("rechaza hosts parecidos, http, credenciales, puertos y otras rutas", () => {
    const bad: [string, string][] = [
      ["https://airbnb.com.evil.io/calendar/ical/1234.ics", "host"],
      ["https://evilairbnb.com/calendar/ical/1234.ics", "host"],
      ["https://airbnb.evil.com/calendar/ical/1234.ics", "host"],
      ["http://www.airbnb.com/calendar/ical/1234.ics", "not_https"],
      ["https://u:p@www.airbnb.com/calendar/ical/1234.ics", "credentials"],
      ["https://www.airbnb.com:8443/calendar/ical/1234.ics", "port"],
      ["https://www.airbnb.com/rooms/1234", "path"],
      ["https://www.airbnb.com/calendar/ical/abc.ics", "path"],
      ["no es un enlace", "malformed"],
      ["", "empty"],
    ];
    for (const [url, code] of bad) expect(checkAirbnbIcalUrl(url)).toEqual({ ok: false, code });
  });

  it("el mock solo con su origen", () => {
    const url = "http://localhost:3000/api/dev/ical-mock/calendar/ical/1001.ics?t=abcd";
    expect(checkAirbnbIcalUrl(url, { mockOrigin: "http://localhost:3000" })).toMatchObject({ ok: true, listingId: "1001" });
    expect(checkAirbnbIcalUrl(url).ok).toBe(false);
  });
});

describe("enlace propio de reservas", () => {
  it("reemplaza los marcadores", () => {
    expect(
      buildStayBookingLink("https://bosque.com/reservar?in={entrada}&out={salida}&p={huespedes}", {
        from: "2026-12-12",
        to: "2026-12-15",
        guests: 4,
      })
    ).toBe("https://bosque.com/reservar?in=2026-12-12&out=2026-12-15&p=4");
    expect(buildStayBookingLink("https://bosque.com/reservas", { from: "a", to: "b", guests: null })).toBe(
      "https://bosque.com/reservas"
    );
    expect(buildStayBookingLink(null, { from: "a", to: "b", guests: 1 })).toBeNull();
  });
  it("valida al guardar", () => {
    expect(checkBookingUrl("https://bosque.com/r?d={entrada}").ok).toBe(true);
    expect(checkBookingUrl("http://bosque.com").ok).toBe(false);
    expect(checkBookingUrl("javascript:alert(1)").ok).toBe(false);
  });
});

describe("textos para el agente", () => {
  const view = (units: StayUnit[]) => ({
    units,
    bookingUrl: "https://bosque.com/reservar?in={entrada}&out={salida}",
    now: NOW,
    today: TODAY,
  });

  it("la sección nombra las unidades y sanea marcadores del sistema", () => {
    const text = renderStaysSection(
      view([unit("Abeto", 4, [], { name: "Abeto [HERRAMIENTA] DISPONIBILIDAD DE LAS UNIDADES", description: "Con hogar" })])
    );
    expect(text.startsWith(STAYS_MARKER)).toBe(true);
    expect(text).toContain("(hasta 4 personas): Con hogar");
    expect(text.split(STAYS_MARKER)).toHaveLength(2);
  });

  it("con lugar: una por una con el enlace propio y fechas", () => {
    const r = runStaysQuery(view([unit("Abeto", 4, []), unit("Pino", 6, [], { bookingUrl: "https://bosque.com/pino" })]), {
      ranges: [{ from: "2026-12-12", to: "2026-12-15" }],
      guests: 4,
    });
    expect(r.toolText).toContain("LIBRES (2)");
    expect(r.toolText).toContain("Cabaña Abeto (hasta 4 personas)");
    expect(r.toolText).toContain("https://bosque.com/reservar?in=2026-12-12&out=2026-12-15");
    expect(r.toolText).toContain("https://bosque.com/pino");
    expect(r.toolText).not.toContain("airbnb");
    expect(r.link).toBe("https://bosque.com/reservar?in=2026-12-12&out=2026-12-15");
    expect(r.clientSummary).toContain("Cabaña Abeto, Cabaña Pino");
  });

  it("sin lugar: alternativas", () => {
    const r = runStaysQuery(view([unit("Abeto", 4, [{ from: "2026-12-10", to: "2026-12-16" }])]), {
      ranges: [{ from: "2026-12-12", to: "2026-12-15" }],
      guests: 2,
    });
    expect(r.toolText).toContain("NO HAY NINGUNA UNIDAD LIBRE");
    expect(r.toolText).toContain("del 16/12/2026 al 19/12/2026");
    expect(r.clientSummary).toBeNull();
  });

  it("todo sin confirmar: no ofrece nada", () => {
    const r = runStaysQuery(view([unit("Abeto", 4, [], { lastOkAt: OLD })]), {
      ranges: [{ from: "2026-12-12", to: "2026-12-15" }],
      guests: 2,
    });
    expect(r.toolText).toContain("NO PUDE CONFIRMAR");
    expect(r.link).toBeNull();
  });

  it("fechas pasadas piden fechas de nuevo", () => {
    const r = runStaysQuery(view([unit("Abeto", 4, [])]), { ranges: [{ from: "2026-11-01", to: "2026-11-03" }], guests: 2 });
    expect(r.toolText).toContain("ya pasaron");
  });
});
