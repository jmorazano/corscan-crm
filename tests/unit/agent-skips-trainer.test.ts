import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 015 (FR-010): el agente de clientes JAMÁS atiende la conversación del
 * entrenador — corta antes de leer la config de IA y de tocar al proveedor.
 */

const getAiConfig = vi.fn();
const chatJson = vi.fn();

vi.mock("@/server/ai/credentials", () => ({ getAiConfig }));
vi.mock("@/lib/ai", () => ({ chatJson }));

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

describe("runAgentTurn ignora kind=trainer", () => {
  beforeEach(() => {
    getAiConfig.mockReset();
    chatJson.mockReset();
    selectQueue.length = 0;
  });

  it("corta antes de getAiConfig y del proveedor", async () => {
    selectQueue.push([
      { id: "cv_t", organizationId: "org_1", contactId: "ct_t", kind: "trainer", isTest: true, aiEnabled: true },
    ]);
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_t");
    expect(getAiConfig).not.toHaveBeenCalled();
    expect(chatJson).not.toHaveBeenCalled();
  });
});
