import { describe, expect, it } from "vitest";
import {
  editBlockingCampaigns,
  pruneApprovedEdits,
  sameBindings,
  templateEditability,
} from "@/lib/template-edit";

const NOW = new Date("2026-11-12T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

describe("templateEditability", () => {
  it("en revisión (o borrador) no se edita", () => {
    for (const status of ["pending", "draft"] as const) {
      const r = templateEditability(status, [], NOW);
      expect(r.canEdit).toBe(false);
      expect(r.reason).toBe("in_review");
      expect(r.nextEditAt).toBeNull();
    }
  });

  it("rechazada: siempre, sin tope y con la categoría libre", () => {
    const many = Array.from({ length: 15 }, (_, i) => hoursAgo(i + 1));
    const r = templateEditability("rejected", many, NOW);
    expect(r).toMatchObject({ canEdit: true, reason: null, categoryLocked: false });
  });

  it("aprobada sin ediciones: se puede, con la categoría bloqueada", () => {
    const r = templateEditability("approved", [], NOW);
    expect(r).toMatchObject({ canEdit: true, categoryLocked: true });
  });

  it("aprobada editada hace 3 h: tope diario, se libera a las 24 h de esa edición", () => {
    const r = templateEditability("approved", [hoursAgo(3)], NOW);
    expect(r.canEdit).toBe(false);
    expect(r.reason).toBe("daily_limit");
    expect(r.nextEditAt).toBe(new Date(NOW.getTime() + 21 * 3600_000).toISOString());
  });

  it("aprobada editada hace 25 h: se puede", () => {
    expect(templateEditability("approved", [hoursAgo(25)], NOW).canEdit).toBe(true);
  });

  it("10 ediciones en 30 días: tope mensual hasta que la más vieja cumpla 30", () => {
    const edits = Array.from({ length: 10 }, (_, i) => daysAgo(29 - i * 2));
    const r = templateEditability("approved", edits, NOW);
    expect(r.reason).toBe("monthly_limit");
    expect(r.nextEditAt).toBe(new Date(NOW.getTime() + 1 * 86400_000).toISOString());
  });

  it("ediciones de hace más de 30 días no cuentan", () => {
    const edits = Array.from({ length: 10 }, (_, i) => daysAgo(31 + i));
    expect(templateEditability("approved", edits, NOW).canEdit).toBe(true);
  });

  it("marcas basura se ignoran", () => {
    expect(templateEditability("approved", ["no-es-fecha", ""], NOW).canEdit).toBe(true);
  });
});

describe("pruneApprovedEdits", () => {
  it("deja solo las de los últimos 30 días, ordenadas", () => {
    expect(pruneApprovedEdits([daysAgo(2), daysAgo(40), daysAgo(5)], NOW)).toEqual([
      daysAgo(5),
      daysAgo(2),
    ]);
    expect(pruneApprovedEdits(null, NOW)).toEqual([]);
  });
});

describe("sameBindings", () => {
  it("compara por posición; null solo es igual a null", () => {
    expect(sameBindings(["contact_name"], ["contact_name"])).toBe(true);
    expect(sameBindings(["contact_name"], ["free_text"])).toBe(false);
    expect(sameBindings(["contact_name"], ["contact_name", "free_text"])).toBe(false);
    expect(sameBindings(null, null)).toBe(true);
    expect(sameBindings(null, undefined)).toBe(true);
    expect(sameBindings(null, [])).toBe(false);
  });
});

describe("editBlockingCampaigns", () => {
  const campaigns = [
    { id: "c1", name: "En curso", status: "running" },
    { id: "c2", name: "Pausada", status: "paused" },
    { id: "c3", name: "Borrador", status: "draft" },
  ];
  it("en curso y pausadas bloquean siempre; borradores solo si cambian los orígenes", () => {
    expect(editBlockingCampaigns(campaigns, true).map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(editBlockingCampaigns(campaigns, false).map((c) => c.id)).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
    expect(editBlockingCampaigns([campaigns[2]!], true)).toEqual([]);
  });
});
