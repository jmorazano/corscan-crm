import { describe, expect, it, vi } from "vitest";

/**
 * US4: tabla de verdad de la elegibilidad (FR-014). Las garantías con BD
 * (claim atómico, at-most-once del revive, generación, pausa por cupo,
 * breaker) se conducen en el guion E2E us-cc-4 contra Postgres real — acá
 * no se simulan con fakes que probarían el fake.
 */

vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("isStillEligible no toca la BD");
  },
  schema: {},
}));

import { isStillEligible } from "@/server/campaigns/recipients";

const base = {
  id: "ct_1",
  organizationId: "org_1",
  phone: "5493516882200",
  name: "Cliente",
  notes: null,
  tags: ["vip"],
  consentSource: "import" as const,
  consentAt: new Date(),
  optedOutAt: null,
  optOutRevertedAt: null,
  optOutRevertedBy: null,
  isTest: false,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("isStillEligible — re-verificación en el momento del envío", () => {
  it("contacto sano de la org → elegible", () => {
    expect(isStillEligible("org_1", base)).toBe(true);
  });

  it.each([
    ["sin consentimiento", { consentSource: null }],
    ["dado de baja sobrevenido", { optedOutAt: new Date() }],
    ["archivado sobrevenido", { archivedAt: new Date() }],
    ["contacto del Laboratorio", { isTest: true }],
    ["de OTRA organización", { organizationId: "org_2" }],
  ])("%s → NO elegible", (_label, overrides) => {
    expect(isStillEligible("org_1", { ...base, ...overrides })).toBe(false);
  });
});
