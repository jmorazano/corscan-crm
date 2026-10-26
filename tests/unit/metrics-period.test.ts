import { describe, expect, it } from "vitest";
import { metricsWindow, periodWindow, unitForDays } from "@/lib/metrics";

/** 040 (research D10): períodos de los asistentes, con paridad con Métricas. */
const BA = "America/Argentina/Buenos_Aires";
// Lunes 26-oct-2026 15:30 en Buenos Aires (UTC−3).
const NOW = new Date("2026-10-26T18:30:00Z");

function ok(input: Parameters<typeof periodWindow>[0], tz = BA, now = NOW) {
  const r = periodWindow(input, tz, now);
  if (!r.ok) throw new Error(r.message);
  return r.window;
}

describe("periodWindow — paridad con la pantalla Métricas", () => {
  it.each([
    ["last_30_days", "day"],
    ["last_12_weeks", "week"],
    ["last_12_months", "year"],
  ] as const)("%s == metricsWindow(%s)", (period, range) => {
    const w = ok({ period });
    const m = metricsWindow(range, BA, NOW);
    expect(w.start).toEqual(m.start);
    expect(w.end).toEqual(m.end);
    expect(w.previousStart).toEqual(m.previousStart);
    expect(w.keys).toEqual(m.keys);
    expect(w.unit).toBe(m.unit);
  });
});

describe("periodWindow — presets", () => {
  it("hoy: desde la medianoche local, compara contra lo transcurrido", () => {
    const w = ok({ period: "today" });
    expect(w.start.toISOString()).toBe("2026-10-26T03:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-27T03:00:00.000Z");
    // 15,5 h transcurridas → la comparación arranca 15,5 h antes.
    expect(w.previousStart.toISOString()).toBe("2026-10-25T11:30:00.000Z");
    expect([w.fromKey, w.toKey]).toEqual(["2026-10-26", "2026-10-26"]);
  });

  it("ayer y la semana pasada son períodos completos", () => {
    const y = ok({ period: "yesterday" });
    expect([y.fromKey, y.toKey]).toEqual(["2026-10-25", "2026-10-25"]);
    expect(y.end.getTime() - y.start.getTime()).toBe(24 * 3600 * 1000);
    expect(y.start.getTime() - y.previousStart.getTime()).toBe(24 * 3600 * 1000);
    const lw = ok({ period: "last_week" });
    expect([lw.fromKey, lw.toKey]).toEqual(["2026-10-19", "2026-10-25"]);
    expect(lw.keys).toHaveLength(7);
  });

  it("esta semana arranca el lunes; este mes, el 1", () => {
    expect(ok({ period: "this_week" }).fromKey).toBe("2026-10-26");
    const tm = ok({ period: "this_month" });
    expect([tm.fromKey, tm.toKey]).toEqual(["2026-10-01", "2026-10-26"]);
    const lm = ok({ period: "last_month" });
    expect([lm.fromKey, lm.toKey]).toEqual(["2026-09-01", "2026-09-30"]);
  });

  it("este año va por mes", () => {
    const w = ok({ period: "this_year" });
    expect(w.fromKey).toBe("2026-01-01");
    expect(w.unit).toBe("month");
    expect(w.keys[0]).toBe("2026-01-01");
    expect(w.keys.at(-1)).toBe("2026-10-01");
  });
});

describe("periodWindow — rango propio", () => {
  it("to inclusive y unidad automática", () => {
    const w = ok({ from: "2026-10-01", to: "2026-10-15" });
    expect(w.keys).toHaveLength(15);
    expect(w.unit).toBe("day");
    expect(w.end.toISOString()).toBe("2026-10-16T03:00:00.000Z");
    // Período pasado completo: la comparación son los 15 días anteriores.
    expect(w.start.getTime() - w.previousStart.getTime()).toBe(15 * 24 * 3600 * 1000);
  });

  it("semanas desde el lunes anterior al inicio", () => {
    const w = ok({ from: "2026-06-03", to: "2026-08-31" });
    expect(w.unit).toBe("week");
    expect(w.keys[0]).toBe("2026-06-01");
  });

  it("errores claros", () => {
    const err = (input: Parameters<typeof periodWindow>[0]) => {
      const r = periodWindow(input, BA, NOW);
      return r.ok ? null : r.message;
    };
    expect(err({ from: "2026-10-15", to: "2026-10-01" })).toMatch(/anterior/);
    expect(err({ from: "2026-02-30", to: "2026-03-01" })).toMatch(/AAAA-MM-DD/);
    expect(err({ from: "2024-01-01", to: "2026-01-01" })).toMatch(/400 días/);
  });

  it("otra zona horaria corta en su medianoche", () => {
    const w = ok({ period: "today" }, "Europe/Madrid");
    expect(w.start.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("unitForDays", () => {
    expect(unitForDays(62)).toBe("day");
    expect(unitForDays(63)).toBe("week");
    expect(unitForDays(182)).toBe("week");
    expect(unitForDays(183)).toBe("month");
  });
});
