import { describe, expect, it } from "vitest";
import { computeFreeSlots, isSlotAvailable, overlaps } from "@/server/calendar/slots";
import { DEFAULT_WEEKLY_HOURS, type WeeklyHours } from "@/server/calendar/rules";
import {
  formatLocalLabel,
  localDateTimeKey,
  parseLocalDateTime,
  tzOffsetMinutes,
  zonedToUtc,
} from "@/lib/time";

/**
 * FR-008 / SC-003: el cálculo de huecos es puro y jamás ofrece algo que se
 * solape con un ocupado; respeta franjas, duración, margen, anticipación,
 * horizonte y la zona horaria del negocio (DST incluido).
 */

const TZ = "America/Argentina/Buenos_Aires"; // UTC-3 sin DST
// Lunes 7-sep-2026 08:00 local = 11:00Z
const NOW = new Date("2026-09-07T11:00:00.000Z");

const rules = {
  slotMinutes: 30,
  bufferMinutes: 0,
  minLeadHours: 2,
  horizonDays: 14,
  weeklyHours: DEFAULT_WEEKLY_HOURS,
};

describe("zona horaria (lib/time)", () => {
  it("zonedToUtc convierte hora local de Buenos Aires (UTC-3)", () => {
    const d = zonedToUtc(TZ, 2026, 9, 7, 9, 0);
    expect(d.toISOString()).toBe("2026-09-07T12:00:00.000Z");
    expect(tzOffsetMinutes(TZ, d)).toBe(-180);
  });

  it("borde de DST en Madrid: la hora local no se corre", () => {
    // 29-mar-2026 es el cambio a horario de verano en Europa (02:00 → 03:00).
    const before = zonedToUtc("Europe/Madrid", 2026, 3, 28, 10, 0);
    const after = zonedToUtc("Europe/Madrid", 2026, 3, 30, 10, 0);
    expect(before.toISOString()).toBe("2026-03-28T09:00:00.000Z"); // UTC+1
    expect(after.toISOString()).toBe("2026-03-30T08:00:00.000Z"); // UTC+2
    expect(localDateTimeKey("Europe/Madrid", after)).toBe("2026-03-30T10:00");
  });

  it("parseLocalDateTime valida formato y calendario", () => {
    expect(parseLocalDateTime("2026-09-07T10:30")).toEqual({
      year: 2026,
      month: 9,
      day: 7,
      hour: 10,
      minute: 30,
    });
    expect(parseLocalDateTime("2026-02-31T10:00")).toBeNull();
    expect(parseLocalDateTime("mañana a las 10")).toBeNull();
    expect(parseLocalDateTime("2026-09-07T25:00")).toBeNull();
  });

  it("formatLocalLabel en español", () => {
    expect(formatLocalLabel(TZ, new Date("2026-09-07T12:00:00.000Z"))).toBe("lun 7 sep 09:00");
  });
});

describe("computeFreeSlots", () => {
  it("genera la grilla del día respetando anticipación mínima", () => {
    const slots = computeFreeSlots({ rules, timezone: TZ, now: NOW, busy: [], days: 1 });
    // 09:00..17:30 = 18 huecos; anticipación 2h desde 08:00 → desde 10:00 → 16.
    expect(slots.length).toBe(16);
    expect(localDateTimeKey(TZ, slots[0]!.start)).toBe("2026-09-07T10:00");
    expect(localDateTimeKey(TZ, slots.at(-1)!.start)).toBe("2026-09-07T17:30");
    expect(slots[0]!.label).toBe("lun 7 sep 10:00");
  });

  it("descarta todo hueco que se solape con un ocupado (sin exponer nada más)", () => {
    const busy = [
      {
        start: zonedToUtc(TZ, 2026, 9, 7, 10, 15),
        end: zonedToUtc(TZ, 2026, 9, 7, 11, 0),
      },
    ];
    const slots = computeFreeSlots({ rules, timezone: TZ, now: NOW, busy, days: 1 });
    const keys = slots.map((s) => localDateTimeKey(TZ, s.start));
    expect(keys).not.toContain("2026-09-07T10:00"); // termina 10:30 > 10:15
    expect(keys).not.toContain("2026-09-07T10:30");
    expect(keys).toContain("2026-09-07T11:00");
    expect(slots.every((s) => busy.every((b) => !overlaps(s, b)))).toBe(true);
  });

  it("dos franjas por día + margen entre turnos", () => {
    const weeklyHours: WeeklyHours = {
      ...DEFAULT_WEEKLY_HOURS,
      "1": [
        ["09:00", "11:00"],
        ["15:00", "16:00"],
      ],
    };
    const slots = computeFreeSlots({
      rules: { ...rules, weeklyHours, bufferMinutes: 15, minLeadHours: 0 },
      timezone: TZ,
      now: NOW,
      busy: [],
      days: 1,
    });
    expect(slots.map((s) => localDateTimeKey(TZ, s.start))).toEqual([
      "2026-09-07T09:00",
      "2026-09-07T09:45",
      "2026-09-07T10:30",
      "2026-09-07T15:00",
    ]);
  });

  it("salta los días sin franja (domingo) y respeta el horizonte", () => {
    const sunday = new Date("2026-09-13T11:00:00.000Z"); // domingo 08:00 local
    const slots = computeFreeSlots({
      rules: { ...rules, horizonDays: 1 },
      timezone: TZ,
      now: sunday,
      busy: [],
      days: 3,
    });
    // Solo el lunes 14 hasta 08:00 del día siguiente (horizonte 1 día):
    // el lunes 14 de 09:00 en adelante queda FUERA del horizonte (>24h).
    expect(slots).toEqual([]);
    const wider = computeFreeSlots({
      rules: { ...rules, horizonDays: 2 },
      timezone: TZ,
      now: sunday,
      busy: [],
      days: 3,
    });
    expect(wider.length).toBeGreaterThan(0);
    expect(wider.every((s) => s.localKey === "2026-09-14")).toBe(true);
  });

  it("fromDate + days acotan el rango; limit acota la cantidad", () => {
    const slots = computeFreeSlots({
      rules,
      timezone: TZ,
      now: NOW,
      busy: [],
      fromDate: "2026-09-09",
      days: 1,
      limit: 3,
    });
    expect(slots.length).toBe(3);
    expect(slots.every((s) => s.localKey === "2026-09-09")).toBe(true);
  });

  it("isSlotAvailable: solo puntos exactos de la grilla libres", () => {
    const base = { rules, timezone: TZ, now: NOW, busy: [] as { start: Date; end: Date }[] };
    expect(isSlotAvailable(zonedToUtc(TZ, 2026, 9, 8, 10, 0), base)).toBe(true);
    expect(isSlotAvailable(zonedToUtc(TZ, 2026, 9, 8, 10, 10), base)).toBe(false); // fuera de grilla
    expect(isSlotAvailable(zonedToUtc(TZ, 2026, 9, 7, 9, 0), base)).toBe(false); // anticipación
    expect(isSlotAvailable(zonedToUtc(TZ, 2026, 9, 13, 10, 0), base)).toBe(false); // domingo
    expect(isSlotAvailable(zonedToUtc(TZ, 2026, 10, 30, 10, 0), base)).toBe(false); // horizonte
    const busy = [{ start: zonedToUtc(TZ, 2026, 9, 8, 9, 45), end: zonedToUtc(TZ, 2026, 9, 8, 10, 15) }];
    expect(isSlotAvailable(zonedToUtc(TZ, 2026, 9, 8, 10, 0), { ...base, busy })).toBe(false);
  });
});
