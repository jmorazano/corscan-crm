import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 025 (US4): con «Este WhatsApp también es mi número personal», el agente
 * NO le contesta a un contacto conocido del celular — corte ANTES del
 * proveedor, sin handoff. Sin el ajuste, o con un contacto nuevo, sigue.
 */
const chatJson = vi.fn();
vi.mock("@/lib/ai", () => ({ chatJson }));
vi.mock("@/server/ai/credentials", () => ({
  getAiConfig: vi.fn().mockResolvedValue({ token: "t", model: "m", judgeModel: "j" }),
}));

const selectQueue: unknown[][] = [];
function thenable(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}
const updates: unknown[] = [];
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenable(selectQueue.shift() ?? []),
    update: () => {
      updates.push(true);
      return { set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) };
    },
  }),
  schema: new Proxy({}, { get: (_t, n) => new Proxy({}, { get: (_t2, c) => `${String(n)}.${String(c)}` }) }),
}));

const now = new Date();
const conv = {
  id: "cv_1",
  organizationId: "org_1",
  contactId: "ct_1",
  kind: "whatsapp",
  isTest: false,
  aiEnabled: true,
  handoffAt: null,
  lastInboundAt: now,
};
const contact = (knownFromPhoneAt: Date | null) => ({
  id: "ct_1",
  name: "Tío Carlos",
  phone: "5493515550000",
  optedOutAt: null,
  knownFromPhoneAt,
  consentSource: "inbound",
  nameEditedAt: null,
  isTest: false,
});
const profile = (sharedPersonalNumber: boolean) => ({
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  name: "Javier",
  sharedPersonalNumber,
});

describe("número personal del dueño", () => {
  beforeEach(() => {
    chatJson.mockReset();
    selectQueue.length = 0;
    updates.length = 0;
  });

  it("contacto conocido del celular + ajuste encendido → no llama al proveedor ni escala", async () => {
    selectQueue.push([conv], [contact(new Date("2026-09-25"))], [profile(true)]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");
    expect(chatJson).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(selectQueue).toHaveLength(0);
  });

  it("sin el ajuste, el mismo contacto sigue su curso (lee el historial)", async () => {
    selectQueue.push([conv], [contact(new Date("2026-09-25"))], [profile(false)], []);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");
    // Llegó a pedir el historial (vacío → sin entrante → corta ahí).
    expect(selectQueue).toHaveLength(0);
    expect(chatJson).not.toHaveBeenCalled();
  });

  it("helpers puros", async () => {
    const { shouldSkipKnownContact, visitStageFor } = await import("@/server/ai/pipeline");
    expect(shouldSkipKnownContact(true, { knownFromPhoneAt: new Date() })).toBe(true);
    expect(shouldSkipKnownContact(true, { knownFromPhoneAt: null })).toBe(false);
    expect(shouldSkipKnownContact(false, { knownFromPhoneAt: new Date() })).toBe(false);
    expect(shouldSkipKnownContact(true, null)).toBe(false);
    const stages = [
      { id: "s1", name: "Nuevo" },
      { id: "s2", name: "Interesado" },
      { id: "s3", name: "Visita coordinada" },
    ];
    expect(visitStageFor(stages)?.id).toBe("s3");
    expect(visitStageFor(stages.slice(0, 2))?.id).toBe("s2");
    expect(visitStageFor([{ id: "s1", name: "Nuevo" }])).toBeNull();
  });
});
