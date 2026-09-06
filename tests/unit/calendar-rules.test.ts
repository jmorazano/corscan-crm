import { describe, expect, it } from "vitest";
import {
  calendarRulesPatchSchema,
  calendarRulesSchema,
  DEFAULT_RULES,
  normalizeWeeklyHours,
} from "@/server/calendar/rules";

/** FR-007 / US2-3: las reglas inválidas se rechazan con motivo. */
describe("reglas de turnos (Zod)", () => {
  it("acepta los defaults y normaliza días ausentes", () => {
    const parsed = calendarRulesSchema.parse({
      ...DEFAULT_RULES,
      weeklyHours: { "1": [["09:00", "12:00"]] },
    });
    expect(parsed.weeklyHours["1"]).toEqual([["09:00", "12:00"]]);
    expect(parsed.weeklyHours["0"]).toEqual([]);
    expect(parsed.weeklyHours["6"]).toEqual([]);
  });

  it("rechaza fin antes que inicio", () => {
    const r = calendarRulesPatchSchema.safeParse({ weeklyHours: { "1": [["12:00", "09:00"]] } });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.success ? "" : r.error.issues)).toMatch(/terminar después/);
  });

  it("rechaza formato de hora incorrecto y franjas solapadas", () => {
    expect(calendarRulesPatchSchema.safeParse({ weeklyHours: { "2": [["9am", "12:00"]] } }).success).toBe(false);
    expect(
      calendarRulesPatchSchema.safeParse({
        weeklyHours: { "2": [["09:00", "12:00"], ["11:00", "13:00"]] },
      }).success
    ).toBe(false);
  });

  it("rechaza zona horaria inválida y rangos numéricos fuera de límite", () => {
    expect(calendarRulesPatchSchema.safeParse({ timezone: "Marte/Olympus" }).success).toBe(false);
    expect(calendarRulesPatchSchema.safeParse({ slotMinutes: 2 }).success).toBe(false);
    expect(calendarRulesPatchSchema.safeParse({ horizonDays: 500 }).success).toBe(false);
    expect(calendarRulesPatchSchema.safeParse({ slotMinutes: 45, horizonDays: 30 }).success).toBe(true);
  });

  it("normalizeWeeklyHours ordena franjas y tolera basura", () => {
    const n = normalizeWeeklyHours({ "3": [["15:00", "18:00"], ["09:00", "12:00"]] });
    expect(n["3"]).toEqual([["09:00", "12:00"], ["15:00", "18:00"]]);
    expect(normalizeWeeklyHours(null)["1"]).toEqual([]);
  });
});
