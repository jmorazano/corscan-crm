import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 017 (FR-006): si lo último de la conversación ya es del negocio (el dueño
 * respondió desde el celular → eco `source='phone'`), el agente no habla
 * encima: corta antes de llamar al proveedor.
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
vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => thenable(selectQueue.shift() ?? []) }),
  schema: new Proxy({}, { get: (_t, n) => new Proxy({}, { get: (_t2, c) => `${String(n)}.${String(c)}` }) }),
}));

describe("runAgentTurn con el último mensaje del negocio", () => {
  beforeEach(() => {
    chatJson.mockReset();
    selectQueue.length = 0;
  });

  it("entrante seguido de un eco del celular → no llama al proveedor", async () => {
    const now = new Date();
    selectQueue.push(
      [{ id: "cv_1", organizationId: "org_1", contactId: "ct_1", kind: "whatsapp", isTest: true, aiEnabled: true, handoffAt: null, lastInboundAt: now }],
      [{ id: "agp_1", organizationId: "org_1", enabled: true, name: "Ari" }],
      // historial desc → se invierte: [in, out]
      [
        { id: "m2", direction: "out", source: "phone", text: "ya te contesto yo", createdAt: now },
        { id: "m1", direction: "in", source: "cloud", text: "¿precio?", createdAt: new Date(now.getTime() - 1000) },
      ]
    );
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_1");
    expect(chatJson).not.toHaveBeenCalled();
  });
});
