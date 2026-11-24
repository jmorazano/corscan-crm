import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CRM-6: la marca `details.receiptAck` se persiste en WhatsApp e Instagram
 * (incluida la reasignación por eco) y llega a `closeWait` desde `reconcileWait`.
 */

const h = vi.hoisted(() => ({
  rows: new Map<unknown, unknown[]>(),
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  echoWon: false,
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
  return {
    ...actual,
    getDb: () => ({
      select: () => ({ from: (t: unknown) => chain(h.rows.get(t) ?? []) }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          h.inserts.push(v);
          const r = { returning: async () => [{ ...v }] };
          return {
            ...r,
            onConflictDoNothing: () => ({ returning: async () => (h.echoWon ? [] : [{ ...v }]) }),
          };
        },
      }),
      update: () => ({
        set: (v: Record<string, unknown>) => {
          h.updates.push(v);
          const c: Record<string, unknown> = {};
          c.where = () => c;
          c.returning = async () => [{ id: "m1", ...v }];
          c.then = (res: (x: unknown) => unknown) => Promise.resolve(undefined).then(res);
          return c;
        },
      }),
    }),
  };
});
vi.mock("@/server/events/bus", () => ({ publish: () => undefined }));
vi.mock("@/server/inbox/ingest", () => ({ serializeMessage: (m: unknown) => m }));
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: async () => ({
    organizationId: "org1",
    status: "connected",
    token: "x".repeat(4),
    phoneNumberId: "pn",
  }),
  markReconnectRequired: async () => undefined,
}));
vi.mock("@/server/instagram/integration", () => ({
  getInstagramIntegration: async () => ({ igUserId: "ig", token: "x".repeat(4), status: "connected" }),
  ensureInstagramToken: async (i: unknown) => i,
  markInstagramReconnectRequired: async () => undefined,
}));
vi.mock("@/lib/meta/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meta/client")>()),
  graphRequest: async () => ({ messages: [{ id: "wamid" }], contacts: [] }),
}));
vi.mock("@/lib/instagram/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/instagram/client")>()),
  sendInstagramMessage: async () => ({ messageId: "mid" }),
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = ["postgresql://u", "p@localhost:5432/t"].join(":");
  process.env.BETTER_AUTH_SECRET = "s".repeat(32);
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "v".repeat(8);
});

beforeEach(() => {
  h.rows.clear();
  h.inserts.length = 0;
  h.updates.length = 0;
  h.echoWon = false;
});

async function setConversation(kind: "whatsapp" | "instagram") {
  const { schema } = await import("@/lib/db");
  h.rows.set(schema.conversation, [
    {
      conversation: { id: "c1", kind, isTest: false, lastInboundAt: new Date() },
      contact: { phone: kind === "instagram" ? "ig:123" : "549111" },
    },
  ]);
}

const send = async (details: { receiptAck?: boolean } | null) => {
  const { sendText } = await import("@/server/inbox/send");
  return sendText({
    conversationId: "c1",
    organizationId: "org1",
    text: "Recibí el comprobante",
    aiGenerated: true,
    details,
  });
};

describe("receiptAck se persiste", () => {
  it("WhatsApp: guarda la marca", async () => {
    await setConversation("whatsapp");
    await send({ receiptAck: true });
    expect(h.inserts[0]!.details).toEqual({ receiptAck: true });
  });

  it("Instagram: guarda la marca al insertar", async () => {
    await setConversation("instagram");
    await send({ receiptAck: true });
    expect(h.inserts[0]).toMatchObject({ aiGenerated: true, details: { receiptAck: true } });
  });

  it("Instagram: sin marca se guarda lo de siempre (null)", async () => {
    await setConversation("instagram");
    await send(null);
    expect(h.inserts[0]!.details).toBeNull();
  });

  it("Instagram: la reasignación por eco conserva la marca", async () => {
    await setConversation("instagram");
    h.echoWon = true;
    await send({ receiptAck: true });
    const reassigned = h.updates.find((u) => u.source === "cloud");
    expect(reassigned).toMatchObject({ aiGenerated: true, details: { receiptAck: true } });
  });
});

describe("reconcileWait", () => {
  it("el acuse no cierra la espera como «agent»; otro mensaje de la IA sí", async () => {
    const { schema } = await import("@/lib/db");
    const { reconcileWait } = await import("@/server/attention/waits");
    const startedAt = new Date(Date.now() - 30 * 60_000);
    const wait = {
      id: "w1",
      organizationId: "org1",
      conversationId: "c1",
      status: "open",
      startReason: "handoff",
      startedAt,
    } as never;
    h.rows.set(schema.conversation, [{ lastInboundAt: new Date() }]);
    const out = (details: unknown) => ({
      text: "x",
      createdAt: new Date(Date.now() - 10 * 60_000),
      aiGenerated: true,
      sentByUserId: null,
      sentByName: null,
      source: "cloud",
      status: "sent",
      details,
    });

    h.rows.set(schema.message, [out({ receiptAck: true })]);
    expect(await reconcileWait(wait)).toBe(wait);
    expect(h.updates).toHaveLength(0);

    h.rows.set(schema.message, [out(null)]);
    await reconcileWait(wait);
    expect(h.updates[0]).toMatchObject({ status: "agent" });
  });
});
