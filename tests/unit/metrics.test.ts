import { describe, expect, it } from "vitest";
import {
  DEFAULT_METRICS_TIMEZONE,
  addMonthsToKey,
  bucketAxisLabel,
  bucketLongLabel,
  deltaRatio,
  fillSeries,
  formatDelta,
  formatDuration,
  metricsWindow,
  niceTicks,
  parseMetricsQuery,
  periodLabel,
} from "@/lib/metrics";

/**
 * Reglas puras de Métricas (024): ventanas en hora LOCAL, serie rellenada
 * con ceros, formatos y la query de la ruta.
 */

const AR = "America/Argentina/Buenos_Aires"; // UTC−3, sin horario de verano
// Sábado 26-sep-2026 15:30 en Buenos Aires = 18:30 UTC.
const NOW = new Date("2026-09-26T18:30:00Z");

describe("parseMetricsQuery", () => {
  it("default: diario y la zona de Buenos Aires", () => {
    expect(parseMetricsQuery(new URLSearchParams())).toEqual({
      ok: true,
      range: "day",
      timeZone: DEFAULT_METRICS_TIMEZONE,
    });
  });

  it("acepta los tres rangos y una zona válida", () => {
    const r = parseMetricsQuery(new URLSearchParams({ range: "year", tz: "Europe/Madrid" }));
    expect(r).toEqual({ ok: true, range: "year", timeZone: "Europe/Madrid" });
  });

  it("zona inválida → Buenos Aires (no es error)", () => {
    const r = parseMetricsQuery(new URLSearchParams({ range: "week", tz: "Marte/Olympus" }));
    expect(r).toEqual({ ok: true, range: "week", timeZone: DEFAULT_METRICS_TIMEZONE });
  });

  it("rango desconocido → error", () => {
    expect(parseMetricsQuery(new URLSearchParams({ range: "month" }))).toEqual({ ok: false });
  });
});

describe("metricsWindow", () => {
  it("diario: 30 días que terminan HOY en hora local", () => {
    const w = metricsWindow("day", AR, NOW);
    expect(w.unit).toBe("day");
    expect(w.keys).toHaveLength(30);
    expect(w.keys[0]).toBe("2026-08-28");
    expect(w.keys[29]).toBe("2026-09-26");
    // Medianoche local = 03:00 UTC.
    expect(w.start.toISOString()).toBe("2026-08-28T03:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-09-27T03:00:00.000Z");
  });

  it("el día se corta en hora local, no en UTC", () => {
    // 01:00 UTC del 27 = 22:00 del 26 en Buenos Aires: sigue siendo el 26.
    const w = metricsWindow("day", AR, new Date("2026-09-27T01:00:00Z"));
    expect(w.keys[29]).toBe("2026-09-26");
  });

  it("semanal: 12 semanas que arrancan en lunes", () => {
    const w = metricsWindow("week", AR, NOW);
    expect(w.unit).toBe("week");
    expect(w.keys).toHaveLength(12);
    expect(w.keys[11]).toBe("2026-09-21"); // lunes de esta semana
    expect(w.keys[0]).toBe("2026-07-06");
    expect(w.end.toISOString()).toBe("2026-09-28T03:00:00.000Z");
  });

  it("semanal un domingo: la semana es la que empezó el lunes anterior", () => {
    const w = metricsWindow("week", AR, new Date("2026-09-27T15:00:00Z")); // domingo
    expect(w.keys[11]).toBe("2026-09-21");
  });

  it("anual: 12 meses por mes, cruzando el año", () => {
    const w = metricsWindow("year", AR, NOW);
    expect(w.unit).toBe("month");
    expect(w.keys).toHaveLength(12);
    expect(w.keys[0]).toBe("2025-10-01");
    expect(w.keys[11]).toBe("2026-09-01");
    expect(w.end.toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });

  it("la comparación usa la MISMA duración transcurrida justo antes", () => {
    const w = metricsWindow("day", AR, NOW);
    const elapsed = NOW.getTime() - w.start.getTime();
    expect(w.start.getTime() - w.previousStart.getTime()).toBe(elapsed);
  });
});

describe("addMonthsToKey", () => {
  it("suma y resta meses cruzando años", () => {
    expect(addMonthsToKey("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonthsToKey("2026-12-01", 1)).toBe("2027-01-01");
  });
});

describe("fillSeries", () => {
  it("rellena con ceros, suma por canal e ignora lo que no corresponde", () => {
    const keys = ["2026-09-24", "2026-09-25", "2026-09-26"];
    const series = fillSeries(keys, [
      { bucket: "2026-09-24", channel: "whatsapp", count: 3 },
      { bucket: "2026-09-26", channel: "instagram", count: 2 },
      { bucket: "2026-09-26", channel: "whatsapp", count: 5 },
      { bucket: "2026-01-01", channel: "whatsapp", count: 99 }, // fuera de la ventana
      { bucket: "2026-09-25", channel: "trainer", count: 7 }, // canal desconocido
    ]);
    expect(series).toEqual([
      { key: "2026-09-24", whatsapp: 3, instagram: 0 },
      { key: "2026-09-25", whatsapp: 0, instagram: 0 },
      { key: "2026-09-26", whatsapp: 5, instagram: 2 },
    ]);
  });
});

describe("formatos", () => {
  it("formatDuration", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(400)).toBe("0 s");
    expect(formatDuration(24_300)).toBe("24 s");
    expect(formatDuration(60_000)).toBe("1 min");
    expect(formatDuration(192_000)).toBe("3 min 12 s");
    expect(formatDuration(18 * 60_000 + 40_000)).toBe("18 min");
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe("2 h 5 min");
    expect(formatDuration(3_600_000)).toBe("1 h");
    expect(formatDuration(27 * 3_600_000)).toBe("1 d 3 h");
  });

  it("deltaRatio sin base no compara", () => {
    expect(deltaRatio(10, 0)).toBeNull();
    expect(deltaRatio(null, 5)).toBeNull();
    expect(deltaRatio(5, null)).toBeNull();
    expect(deltaRatio(15, 10)).toBeCloseTo(0.5);
  });

  it("formatDelta", () => {
    expect(formatDelta(0.123)).toBe("+12 %");
    expect(formatDelta(-0.08)).toBe("−8 %");
    expect(formatDelta(0.001)).toBe("0 %");
    expect(formatDelta(12.5)).toBe("+1.250 %");
  });

  it("etiquetas del eje y del tooltip", () => {
    expect(bucketAxisLabel("2026-09-26", "day")).toBe("26/9");
    expect(bucketAxisLabel("2026-09-01", "month")).toBe("sep");
    expect(bucketAxisLabel("2027-01-01", "month")).toBe("ene 27");
    expect(bucketLongLabel("2026-09-26", "day")).toBe("sábado 26 de septiembre");
    expect(bucketLongLabel("2026-09-21", "week")).toBe("21 al 27 de septiembre");
    expect(bucketLongLabel("2026-09-28", "week")).toBe("28 de septiembre al 4 de octubre");
    expect(bucketLongLabel("2026-09-01", "month")).toBe("septiembre 2026");
  });

  it("periodLabel", () => {
    const w = metricsWindow("day", AR, NOW);
    expect(periodLabel(w.keys, "day", NOW, AR)).toBe("28 ago – 26 sep 2026");
    const y = metricsWindow("year", AR, NOW);
    expect(periodLabel(y.keys, "month", NOW, AR)).toBe("oct 2025 – 26 sep 2026");
  });

  it("niceTicks: valores redondos que cubren el máximo", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(17)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(1284)).toEqual([0, 500, 1000, 1500]);
    for (const max of [1, 7, 42, 99, 250, 3333]) {
      const t = niceTicks(max);
      expect(t[t.length - 1]!).toBeGreaterThanOrEqual(max);
      expect(t.length).toBeLessThanOrEqual(6);
    }
  });
});
