import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CRM-6: `runAgentTurn` con BD, proveedor y envío simulados. El acuse sale con
 * el texto fijo, sin modelo y sin tocar la atención humana ni el switch.
 */

const h = vi.hoisted(() => ({
  rows: new Map<unknown, unknown[]>(),
  updates: [] as unknown[],
  inserts: [] as unknown[],
  sendText: vi.fn(async (_input: unknown) => ({ messageId: "m_out" })),
  chatJson: vi.fn(),
  lastTeam: vi.fn(async (_o: string, _c: string, opts?: { skipFailed?: boolean }) =>
    opts?.skipFailed ? (h.deliveredTeamAt as Date | null) : (h.anyTeamAt as Date | null)
  ),
  anyTeamAt: null as Date | null,
  deliveredTeamAt: null as Date | null,
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const k of ["where", "orderBy", "limit", "innerJoin"]) c[k] = () => c;
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve([...rows]).then(res, rej);
    return c;
  };
  const write = (list: unknown[]) => (v: unknown) => {
    list.push(v);
    const c: Record<string, unknown> = {};
    c.where = () => c;
    c.values = () => c;
    c.returning = () => Promise.resolve([]);
    c.onConflictDoNothing = () => c;
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(undefined).then(res);
    return c;
  };
  return {
    ...actual,
    getDb: () => ({
      select: () => ({ from: (t: unknown) => chain(h.rows.get(t) ?? []) }),
      update: () => ({ set: write(h.updates) }),
      insert: () => ({ values: write(h.inserts) }),
    }),
  };
});
vi.mock("@/server/ai/credentials", () => ({ getAiConfig: async () => ({ provider: "x" }) }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  chatJson: h.chatJson,
}));
vi.mock("@/server/ai/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/ai/events")>()),
  lastTeamMessageAt: h.lastTeam,
}));
vi.mock("@/server/inbox/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/inbox/send")>()),
  sendText: h.sendText,
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = ["postgresql://u", "p@localhost:5432/t"].join(":");
  process.env.BETTER_AUTH_SECRET = "s".repeat(32);
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "v".repeat(8);
});

const MIN = 60_000;
const ago = (m: number) => new Date(Date.now() - m * MIN);

type Setup = {
  aiEnabled?: boolean;
  handoffAt?: Date | null;
  option?: boolean;
  history: Record<string, unknown>[]; // más nuevo primero
};

async function setup(s: Setup) {
  const { schema } = await import("@/lib/db");
  h.rows.set(schema.conversation, [
    {
      id: "c1",
      organizationId: "org1",
      contactId: "ct1",
      kind: "whatsapp",
      isTest: false,
      aiEnabled: s.aiEnabled ?? true,
      handoffAt: s.handoffAt === undefined ? ago(5) : s.handoffAt,
      handoffReason: "cliente",
      lastInboundAt: ago(1),
    },
  ]);
  h.rows.set(schema.contact, [
    { id: "ct1", name: "Ana", phone: "549", optedOutAt: null, optedOutSource: null, knownFromPhoneAt: null },
  ]);
  h.rows.set(schema.agentProfile, [
    {
      organizationId: "org1",
      enabled: true,
      tagPaymentReceipts: s.option ?? true,
      sharedPersonalNumber: false,
      teamSilenceMs: 10 * MIN,
    },
  ]);
  h.rows.set(schema.message, s.history);
}

const msg = (over: Record<string, unknown>) => ({
  id: `m${Math.random()}`,
  direction: "in",
  type: "text",
  text: null,
  createdAt: ago(1),
  aiGenerated: false,
  status: "received",
  source: "cloud",
  sentByUserId: null,
  mediaState: null,
  mediaSummary: null,
  details: null,
  ...over,
});
const receipt = (over: Record<string, unknown> = {}) =>
  msg({
    type: "image",
    mediaState: "ready",
    mediaSummary: "Comprobante de transferencia bancaria realizada.",
    ...over,
  });

beforeEach(() => {
  h.rows.clear();
  h.updates.length = 0;
  h.inserts.length = 0;
  h.sendText.mockClear();
  h.chatJson.mockReset();
  h.lastTeam.mockClear();
  h.anyTeamAt = null;
  h.deliveredTeamAt = null;
});

describe("runAgentTurn — acuse de comprobante (CRM-6)", () => {
  it("manda solo el texto fijo, sin modelo, y no toca handoff ni el switch", async () => {
    await setup({ history: [receipt()] });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("c1");
    expect(h.sendText).toHaveBeenCalledTimes(1);
    expect(h.sendText.mock.calls[0]![0]).toMatchObject({
      text: "Recibí el comprobante, gracias. Ahora corroboramos el ingreso del pago.",
      aiGenerated: true,
      details: { receiptAck: true },
    });
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it("también con la IA del chat apagada y sin marca de atención humana", async () => {
    await setup({ aiEnabled: false, handoffAt: null, history: [receipt()] });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("c1");
    expect(h.sendText).toHaveBeenCalledTimes(1);
    expect(h.updates).toHaveLength(0);
  });

  it("con la opción apagada no manda nada", async () => {
    await setup({ option: false, history: [receipt()] });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("c1");
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it("un envío fallido del equipo no cuenta como respuesta", async () => {
    h.anyTeamAt = ago(0.5); // el que falló
    h.deliveredTeamAt = null;
    await setup({ history: [receipt()] });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("c1");
    expect(h.lastTeam).toHaveBeenCalledWith("org1", "c1", { skipFailed: true });
    expect(h.sendText).toHaveBeenCalledTimes(1);
  });

  it("si el equipo ya respondió (entregado), no acusa", async () => {
    h.deliveredTeamAt = ago(0.5);
    await setup({ history: [receipt()] });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("c1");
    expect(h.sendText).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Recibí") }));
  });

  it("con la lectura del comprobante pendiente y la ventana del equipo vencida, no retoma ni llama al modelo", async () => {
    // handoff hace 60 min, el equipo escribió hace 50 (ventana de 10 min vencida):
    // sin la espera, el texto retomaría y borraría handoffAt antes de leer el comprobante.
    h.anyTeamAt = ago(50);
    h.deliveredTeamAt = ago(50);
    await setup({
      handoffAt: ago(60),
      history: [
        msg({ text: "ya te lo mandé", createdAt: ago(0.5) }),
        receipt({ mediaState: "pending", mediaSummary: null, createdAt: ago(1) }),
        msg({ direction: "out", aiGenerated: false, sentByUserId: "u1", createdAt: ago(50) }),
      ],
    });
    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("c1");
    expect(h.sendText).not.toHaveBeenCalled();
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });
});
