import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebhookValue } from "@/server/inbox/webhook";

/**
 * CRM-5: la reacción del cliente (WhatsApp e Instagram) despierta al agente.
 * Ingesta REAL (`processMessagesValue`, `processInstagramWebhook`) con la BD
 * y el disparador simulados.
 */

const state = vi.hoisted(() => ({
  conversation: null as { id: string; lastInboundAt: Date | null } | null,
  duplicate: false,
  inserted: [] as { table: unknown; values: Record<string, unknown> }[],
  updates: 0,
  agentTurns: [] as string[],
  standbySeen: 0,
  push: 0,
}));

vi.mock("@/server/events/bus", () => ({ publish: () => {}, subscribe: () => () => {} }));

vi.mock("@/server/ai/trigger", () => ({
  maybeRunAgentTurn: (organizationId: string, conversationId: string) => {
    state.agentTurns.push(`${organizationId}:${conversationId}`);
    return Promise.resolve();
  },
}));

vi.mock("@/server/push/events", () => ({
  notifyInboundMessage: () => {
    state.push++;
    return Promise.resolve();
  },
}));

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByPhoneNumberId: () => Promise.resolve({ organizationId: "org_1" }),
}));

vi.mock("@/server/instagram/integration", () => ({
  getInstagramIntegrationByAccount: () => Promise.resolve({ organizationId: "org_1" }),
  markInstagramStandbySeen: () => {
    state.standbySeen++;
    return Promise.resolve();
  },
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const schema = actual.schema;
  const rowsFor = (table: unknown) => {
    if (table === schema.conversation) return state.conversation ? [state.conversation] : [];
    if (table === schema.message) return [{ id: "msg_out_1", type: "text", text: "¿Te busco del 05/01 al 08/01?" }];
    return [];
  };
  const from = (table: unknown) => {
    const chain = {
      innerJoin: () => chain,
      where: () => ({ limit: () => Promise.resolve(rowsFor(table)) }),
    };
    return chain;
  };
  const db = {
    select: () => ({ from }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          if (!state.duplicate) state.inserted.push({ table, values });
          return { returning: () => Promise.resolve(state.duplicate ? [] : [{ id: "msg_r", ...values }]) };
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          state.updates++;
          return Promise.resolve();
        },
      }),
    }),
  };
  return { ...actual, getDb: () => db };
});

const NOW = () => new Date();
const HOURS = (n: number) => new Date(Date.now() - n * 3_600_000);

beforeEach(() => {
  state.conversation = { id: "cv_1", lastInboundAt: NOW() };
  state.duplicate = false;
  state.inserted.length = 0;
  state.updates = 0;
  state.agentTurns.length = 0;
  state.standbySeen = 0;
  state.push = 0;
});

async function whatsappReaction(emoji: string) {
  const { processMessagesValue } = await import("@/server/inbox/ingest");
  await processMessagesValue({
    metadata: { phone_number_id: "pn_1" },
    messages: [
      {
        from: "5493413418685",
        id: "wamid.react.1",
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "reaction",
        reaction: { message_id: "wamid.out.1", emoji },
      },
    ],
  } as unknown as WebhookValue);
}

/** `action: null` = el campo ausente. */
async function instagramReaction(opts: { action?: string | null; standby?: boolean } = {}) {
  const { processInstagramWebhook } = await import("@/server/instagram/ingest");
  const messaging = {
    sender: { id: "cust_1" },
    recipient: { id: "acc_1" },
    timestamp: Date.now(),
    reaction: {
      mid: "mid.out.1",
      emoji: "😍",
      ...(opts.action === null ? {} : { action: opts.action === undefined ? "react" : opts.action }),
    },
  };
  await processInstagramWebhook({
    object: "instagram",
    entry: [
      {
        id: "acc_1",
        time: Date.now(),
        ...(opts.standby ? { standby: [messaging] } : { messaging: [messaging] }),
      },
    ],
  });
}

describe("CRM-5: WhatsApp", () => {
  it("la reacción queda como nota y agenda un turno", async () => {
    await whatsappReaction("👍");
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.values).toMatchObject({
      type: "reaction",
      direction: "in",
      text: "👍",
      // La identidad del mensaje reaccionado viaja con la reacción (CRM-5).
      details: { reactionTo: "¿Te busco del 05/01 al 08/01?", reactionToId: "msg_out_1" },
    });
    expect(state.agentTurns).toEqual(["org_1:cv_1"]);
  });

  it("efectos laterales de 038 intactos: sin no leídos, lead, push ni update", async () => {
    await whatsappReaction("👍");
    expect(state.updates).toBe(0);
    expect(state.push).toBe(0);
  });

  it("reentrega (mismo id): no duplica ni despierta otra vez", async () => {
    state.duplicate = true;
    await whatsappReaction("👍");
    expect(state.inserted).toHaveLength(0);
    expect(state.agentTurns).toHaveLength(0);
  });

  it("reacción quitada (emoji vacío): no hace nada", async () => {
    await whatsappReaction("");
    expect(state.inserted).toHaveLength(0);
    expect(state.agentTurns).toHaveLength(0);
  });

  it("ventana de 24 h cerrada: se guarda la nota pero no hay turno", async () => {
    state.conversation = { id: "cv_1", lastInboundAt: HOURS(30) };
    await whatsappReaction("👍");
    expect(state.inserted).toHaveLength(1);
    expect(state.agentTurns).toHaveLength(0);
  });

  it("conversación inexistente: no se crea nada ni hay turno", async () => {
    state.conversation = null;
    await whatsappReaction("👍");
    expect(state.inserted).toHaveLength(0);
    expect(state.agentTurns).toHaveLength(0);
  });
});

describe("CRM-5: Instagram", () => {
  it("la reacción queda como nota y agenda un turno", async () => {
    await instagramReaction();
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.values).toMatchObject({ type: "reaction", text: "😍" });
    expect(state.agentTurns).toEqual(["org_1:cv_1"]);
  });

  it("quitar la reacción no hace nada", async () => {
    await instagramReaction({ action: "unreact" });
    expect(state.inserted).toHaveLength(0);
    expect(state.agentTurns).toHaveLength(0);
  });

  it("reentrega: no despierta otra vez", async () => {
    state.duplicate = true;
    await instagramReaction();
    expect(state.agentTurns).toHaveLength(0);
  });

  it("ventana cerrada: sin turno", async () => {
    state.conversation = { id: "cv_1", lastInboundAt: HOURS(48) };
    await instagramReaction();
    expect(state.agentTurns).toHaveLength(0);
  });

  it("conversación inexistente: nada", async () => {
    state.conversation = null;
    await instagramReaction();
    expect(state.inserted).toHaveLength(0);
    expect(state.agentTurns).toHaveLength(0);
  });

  it("standby (otra app maneja el hilo): se guarda marcada y corre el turno, que solo deja la línea «standby» (no envía)", async () => {
    await instagramReaction({ standby: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]!.values.details).toMatchObject({ standby: true });
    // El turno corre para dejar la traza; el pipeline lo corta antes de enviar
    // (ver reaction-turn-crm5: «standby con un turno pendiente»).
    expect(state.agentTurns).toEqual(["org_1:cv_1"]);
    expect(state.standbySeen).toBe(1);
  });

  it.each([["" as string], ["otra"], [null]])(
    "acción %j (vacía, desconocida o ausente): el webhook completo no guarda ni despierta",
    async (action) => {
      await instagramReaction({ action });
      expect(state.inserted).toHaveLength(0);
      expect(state.agentTurns).toHaveLength(0);
    }
  );
});

describe("CRM-5: el turno de la reacción (pipeline)", () => {
  const hist = (...m: [string, string, string][]) => m.map(([id, direction, type]) => ({ id, direction, type }));

  it("lastInbound y latestInboundId resuelven la misma reacción: una sola regeneración", async () => {
    const { conversationalReplyDecision } = await import("@/server/ai/pipeline");
    const { isAgentTurnMessage } = await import("@/lib/inbound-media");
    // La reacción llega mientras el agente generaba para el mensaje m1.
    const recent = hist(["r1", "in", "reaction"], ["m1", "in", "text"]);
    const latest = recent.find(isAgentTurnMessage)?.id ?? null;
    const base = { lastOutboundText: "¿Te busco?", text: "Perfecto" };
    expect(conversationalReplyDecision({ ...base, turnInboundId: "m1", latestInboundId: latest })).toBe("stale");
    // El turno regenerado toma la reacción como su mensaje y responde.
    expect(conversationalReplyDecision({ ...base, turnInboundId: "r1", latestInboundId: latest })).toBe("send");
  });

  it("la retoma no cuenta la reacción como pendiente (confirmación)", async () => {
    const { pendingCustomerMessages } = await import("@/server/ai/pipeline");
    expect(pendingCustomerMessages(hist(["t1", "out", "text"], ["r1", "in", "reaction"]))).toEqual([]);
  });
});
