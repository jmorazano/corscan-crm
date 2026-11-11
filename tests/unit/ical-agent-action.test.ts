import { describe, expect, it } from "vitest";
import { AgentAction, isConcreteAvailabilityQuery, isStaysAction } from "@/server/ai/actions";
import { rangesOf } from "@/server/ical/agent-tools";

/** 051: el contrato de `check_stays` es laxo como `search_stays`. */
describe("check_stays", () => {
  it("acepta rangos, fechas sueltas y huéspedes como texto", () => {
    const a = AgentAction.parse({ action: "check_stays", ranges: [{ check_in: "2026-12-12", check_out: "2026-12-15" }], guests: "4" });
    expect(isStaysAction(a)).toBe(true);
    expect(a).toMatchObject({ guests: 4 });
    const b = AgentAction.parse({ action: "check_stays", check_in: "12/12/2026", check_out: "15/12/2026", lead_note: "4 personas" });
    expect(isStaysAction(b) && rangesOf(b)).toEqual([{ from: "2026-12-12", to: "2026-12-15" }]);
  });

  it("basura en guests o ranges no rompe la acción", () => {
    const a = AgentAction.parse({ action: "check_stays", ranges: "mañana", guests: "muchos", check_in: "2026-12-12", check_out: "2026-12-13" });
    expect(isStaysAction(a) && rangesOf(a)).toEqual([{ from: "2026-12-12", to: "2026-12-13" }]);
  });

  it("con entrada y salida es consulta concreta (044 → interesados)", () => {
    expect(isConcreteAvailabilityQuery(AgentAction.parse({ action: "check_stays", check_in: "2026-12-12", check_out: "2026-12-15" }))).toBe(true);
    expect(isConcreteAvailabilityQuery(AgentAction.parse({ action: "check_stays", check_in: "2026-12-12" }))).toBe(false);
  });

  it("rangos incompletos se descartan y se corta en 3", () => {
    const a = AgentAction.parse({
      action: "check_stays",
      ranges: [
        { check_in: "2026-12-01", check_out: "2026-12-03" },
        { check_in: "2026-12-05" },
        { check_in: "2026-12-06", check_out: "2026-12-08" },
        { check_in: "2026-12-09", check_out: "2026-12-10" },
        { check_in: "2026-12-11", check_out: "2026-12-12" },
      ],
    });
    expect(isStaysAction(a) && rangesOf(a)).toHaveLength(2);
  });
});
