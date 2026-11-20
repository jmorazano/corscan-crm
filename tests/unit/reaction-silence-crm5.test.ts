import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CRM-5 (AC3): cada reacción deja su traza. `recordSilence` no funde el
 * silencio de una reacción con el de OTRA, pero sí deduplica el mismo turno
 * repetido de la misma reacción.
 */

const state = vi.hoisted(() => ({
  events: [] as { kind: string; reason: string | null; details: Record<string, unknown> | null; createdAt: Date }[],
  lastDetails: null as unknown,
  inserted: 0,
}));

vi.mock("@/server/events/bus", () => ({ publish: () => {}, subscribe: () => () => {} }));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const schema = actual.schema;
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(table === schema.conversationEvent ? state.events : []),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          state.inserted++;
          state.lastDetails = v.details;
          return Promise.resolve([
            { id: "ev_1", kind: v.kind, reason: v.reason, actorName: null, details: v.details, createdAt: new Date() },
          ]);
        },
      }),
    }),
  };
  return { ...actual, getDb: () => db };
});

const base = { organizationId: "org_1", conversationId: "cv_1", reason: "no_reply_needed" as const };
const ago = (ms: number) => new Date(Date.now() - ms);
const silent = (inboundId?: string) => ({
  kind: "ai_silent",
  reason: "no_reply_needed",
  details: inboundId ? { inboundId } : null,
  createdAt: ago(1000),
});

beforeEach(() => {
  state.inserted = 0;
  state.lastDetails = null;
  state.events = [silent()];
});

describe("recordSilence con reacciones", () => {
  it("sin reacción, el silencio repetido se deduplica como siempre", async () => {
    const { recordSilence } = await import("@/server/ai/events");
    await recordSilence(base);
    expect(state.inserted).toBe(0);
  });

  it("una reacción nueva deja su propia línea aunque el motivo se repita, marcada con su id", async () => {
    const { recordSilence } = await import("@/server/ai/events");
    await recordSilence({ ...base, reaction: { id: "r2", createdAt: ago(5000) } });
    expect(state.inserted).toBe(1);
    expect(state.lastDetails).toMatchObject({ inboundId: "r2" });
  });

  it("r1 registra su silencio DESPUÉS de que llegó r2: el turno de r2 igual deja la suya", async () => {
    const { recordSilence } = await import("@/server/ai/events");
    state.events = [silent("r1")];
    await recordSilence({ ...base, reaction: { id: "r2", createdAt: ago(5000) } });
    expect(state.inserted).toBe(1);
  });

  it("el mismo turno de la misma reacción repetido no duplica", async () => {
    const { recordSilence } = await import("@/server/ai/events");
    state.events = [silent("r2")];
    await recordSilence({ ...base, reaction: { id: "r2", createdAt: ago(5000) } });
    expect(state.inserted).toBe(0);
  });
});
