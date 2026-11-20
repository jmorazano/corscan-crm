import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CRM-5: el turno REAL (`runAgentTurn` + coalesce) cuando lo que el cliente
 * mandó es una reacción. BD, modelo y envío simulados; las lecturas de mensajes
 * se resuelven por su `limit` (1 = último entrante, 20 = historial, 6 = chequeo
 * de respuesta vieja), el resto por tabla.
 */

const h = vi.hoisted(() => ({
  chatJson: vi.fn(),
  lastTeamAt: null as Date | null,
  silences: [] as { reason: string; reaction?: { id: string }; details?: unknown }[],
  sent: [] as string[],
  tables: {} as Record<string, unknown[][]>,
  latestIn: [] as unknown[],
  history: [] as unknown[],
  recent: [] as unknown[],
  /** Tipos de evento de conversación registrados (handoff, etc.). */
  events: [] as string[],
  /** Lectura de un mensaje por id (sin `limit`). */
  byId: [] as unknown[],
  /** Qué diría la clasificación de difusión (036) para un mensaje sin marca. */
  detectedBroadcast: false,
}));

vi.mock("@/lib/ai", () => ({ chatJson: h.chatJson }));
vi.mock("@/server/ai/credentials", () => ({
  getAiConfig: vi.fn().mockResolvedValue({ token: "t", model: "m", judgeModel: "j" }),
}));

vi.mock("@/server/ai/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ai/events")>();
  return {
    ...actual,
    lastTeamMessageAt: () => Promise.resolve(h.lastTeamAt),
    isTeamBroadcastMessage: (_o: string, _c: string, row: { details: { broadcast?: boolean } | null }) =>
      Promise.resolve(Boolean(row.details?.broadcast) || h.detectedBroadcast),
    recordSilence: (input: { reason: string; reaction?: { id: string }; details?: unknown }) => {
      h.silences.push(input);
      return Promise.resolve();
    },
    recordConversationEvent: (input: { kind: string }) => {
      h.events.push(input.kind);
      return Promise.resolve(null);
    },
  };
});

vi.mock("@/server/inbox/lead-stage", () => ({
  loadLeadStageState: () =>
    Promise.resolve({
      stages: [{ id: "stg_1", name: "Interesado", kind: "open", position: 1 }],
      leadId: null,
      current: null,
      optedOut: false,
      staleLost: false,
    }),
  advanceLeadStage: () => Promise.resolve(null),
}));

vi.mock("@/server/inbox/send", () => ({
  SendError: class SendError extends Error {
    code = "x";
  },
  sendText: (input: { text: string }) => {
    h.sent.push(input.text);
    return Promise.resolve();
  },
}));

vi.mock("@/lib/db", () => {
  const tableProxies = new Map<string, unknown>();
  const table = (name: string) => {
    if (!tableProxies.has(name)) {
      tableProxies.set(
        name,
        new Proxy({}, { get: (_t, c) => (c === "__name" ? name : `${name}.${String(c)}`) })
      );
    }
    return tableProxies.get(name);
  };
  const rowsFor = (name: string, limit: number | null): unknown[] => {
    if (name === "message" && limit === 1) return h.latestIn;
    if (name === "message" && limit === 20) return h.history;
    if (name === "message" && limit === 6) return h.recent;
    if (name === "message" && limit === null) return h.byId;
    return h.tables[name]?.shift() ?? [];
  };
  const chain = (name: string) => {
    let limit: number | null = null;
    const c: Record<string, unknown> = {};
    for (const m of ["innerJoin", "where", "orderBy"]) c[m] = () => c;
    c.limit = (n: number) => {
      limit = n;
      return c;
    };
    c.then = (resolve: (v: unknown) => void) => Promise.resolve(rowsFor(name, limit)).then(resolve);
    return c;
  };
  const writeChain = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["onConflictDoNothing", "where", "set", "values"]) c[m] = () => c;
    c.returning = () => Promise.resolve([{}]);
    c.then = (resolve: (v: unknown) => void) => Promise.resolve([{}]).then(resolve);
    return c;
  };
  return {
    getDb: () => ({
      select: () => ({ from: (t: { __name: string }) => chain(t.__name) }),
      insert: () => writeChain(),
      update: () => writeChain(),
    }),
    schema: new Proxy({}, { get: (_t, n) => table(String(n)) }),
  };
});

const t = (mins: number) => new Date(Date.UTC(2026, 10, 15, 12, mins));
const conv = {
  id: "cv_1",
  organizationId: "org_1",
  contactId: "ct_1",
  kind: "whatsapp",
  isTest: false,
  aiEnabled: true,
  handoffAt: null,
  handoffReason: null,
  lastInboundAt: new Date(),
};
const contact = (known: Date | null = null) => ({
  id: "ct_1",
  name: "Damian",
  phone: "5493413418685",
  optedOutAt: null,
  optedOutSource: null,
  knownFromPhoneAt: known,
  consentSource: "inbound",
  nameEditedAt: null,
  isTest: false,
});
const profile = (over: Record<string, unknown> = {}) => ({
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  name: "Giuliana",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
  sharedPersonalNumber: false,
  teamSilenceMs: 10 * 60_000,
  ...over,
});
const msg = (over: Record<string, unknown>) => ({
  organizationId: "org_1",
  conversationId: "cv_1",
  aiGenerated: false,
  source: null,
  sentByUserId: null,
  apiKeyId: null,
  details: null,
  text: null,
  mediaState: null,
  mediaSummary: null,
  ...over,
});
const question = msg({ id: "q1", direction: "out", type: "text", aiGenerated: true, text: "¿Te busco del 05/01?", createdAt: t(0) });
const typed = msg({ id: "m1", direction: "in", type: "text", text: "hola", createdAt: t(1) });
const reaction = (id: string, mins: number, details: unknown = null) =>
  msg({ id, direction: "in", type: "reaction", text: "👍", createdAt: t(mins), details });

/** `desc`: del más nuevo al más viejo, como los devuelve la BD. */
function arrange(opts: {
  contact?: unknown;
  profile?: unknown;
  conv?: unknown;
  desc: unknown[];
}) {
  h.tables = {
    conversation: [[opts.conv ?? conv]],
    contact: [[opts.contact ?? contact()]],
    agentProfile: [[opts.profile ?? profile()]],
  };
  h.latestIn = [opts.desc.find((m) => (m as { direction: string }).direction === "in")];
  // Copias: el pipeline invierte el historial en el lugar.
  h.history = [...opts.desc];
  h.recent = [...opts.desc];
}

beforeAll(() => {
  Object.assign(process.env, {
    APP_BASE_URL: "http://localhost:3000",
    DATABASE_URL: "postgresql://t:t@localhost:5432/t",
    BETTER_AUTH_SECRET: "s".repeat(32),
    ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    META_WEBHOOK_VERIFY_TOKEN: "v".repeat(12),
  });
});

beforeEach(() => {
  h.chatJson.mockReset();
  h.lastTeamAt = null;
  h.silences.length = 0;
  h.sent.length = 0;
  h.byId = [];
  h.detectedBroadcast = false;
  h.events.length = 0;
});

/** Contenido de los mensajes `user` (el historial del cliente) de la llamada n al modelo. */
function userMessagesOf(call: number): string[] {
  const args = h.chatJson.mock.calls[call] as unknown[];
  const list = args.find(Array.isArray) as { role: string; content: unknown }[];
  return list.filter((m) => m.role === "user").map((m) => String(m.content));
}

async function turn() {
  const { runAgentTurn } = await import("@/server/ai/pipeline");
  await runAgentTurn("cv_1");
}

describe("CRM-5: runAgentTurn con una reacción", () => {
  it("retoma: 👍 al mensaje del equipo con la ventana del equipo YA vencida → no responde, deja la línea", async () => {
    // Equipo 12:00, ventana de 10 min, reacción 12:12.
    h.lastTeamAt = t(0);
    const team = msg({ id: "t1", direction: "out", type: "text", source: "phone", text: "Hola, te cotizo", createdAt: t(0) });
    arrange({ desc: [reaction("r1", 12, { reactionToId: "t1" }), team] });
    await turn();
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.silences).toHaveLength(1);
    expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed", reaction: { id: "r1" } });
  });

  it("equipo → vence su ventana → pregunta de la IA → 👍 al mensaje del EQUIPO: se silencia (importa el mensaje reaccionado)", async () => {
    h.lastTeamAt = t(0);
    const team = msg({ id: "t1", direction: "out", type: "text", source: "phone", text: "Hola, te cotizo", createdAt: t(0) });
    const aiQuestion = msg({ id: "q2", direction: "out", type: "text", aiGenerated: true, text: "¿Te busco?", createdAt: t(20) });
    arrange({ desc: [reaction("r8", 25, { reactionToId: "t1" }), aiQuestion, team] });
    await turn();
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed", reaction: { id: "r8" } });
  });

  it("equipo → pregunta de la IA → 👍 a la pregunta de la IA: NO se silencia, responde el modelo", async () => {
    h.lastTeamAt = t(0);
    const team = msg({ id: "t1", direction: "out", type: "text", source: "phone", text: "Hola, te cotizo", createdAt: t(0) });
    const aiQuestion = msg({ id: "q2", direction: "out", type: "text", aiGenerated: true, text: "¿Te busco?", createdAt: t(20) });
    arrange({ desc: [reaction("r9", 25, { reactionToId: "q2" }), aiQuestion, team] });
    h.chatJson.mockResolvedValue({ ok: true, data: { action: "reply", text: "Dale, te busco." }, raw: "{}" });
    await turn();
    expect(h.chatJson).toHaveBeenCalledTimes(1);
    expect(h.silences).toHaveLength(0);
    expect(h.sent).toEqual(["Dale, te busco."]);
  });

  it("equipo 12:00 → «ok» 12:01 → vence la ventana → 👍 al mensaje del equipo 12:12: se silencia (acuse + reacción)", async () => {
    h.lastTeamAt = t(0);
    const team = msg({ id: "t1", direction: "out", type: "text", source: "phone", text: "Hola, te cotizo", createdAt: t(0) });
    const ok = msg({ id: "m_ok", direction: "in", type: "text", text: "ok", createdAt: t(1) });
    arrange({ desc: [reaction("r13", 12, { reactionToId: "t1" }), ok, team] });
    await turn();
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed", reaction: { id: "r13" } });
  });

  it("acuse + reacción, pero con una pregunta escrita pendiente: no se silencia", async () => {
    h.lastTeamAt = t(0);
    const team = msg({ id: "t1", direction: "out", type: "text", source: "phone", text: "Hola, te cotizo", createdAt: t(0) });
    const ask = msg({ id: "m_q", direction: "in", type: "text", text: "¿y cuánto sale?", createdAt: t(1) });
    arrange({ desc: [reaction("r14", 12, { reactionToId: "t1" }), ask, team] });
    h.chatJson.mockResolvedValue({ ok: true, data: { action: "reply", text: "Sale 100." }, raw: "{}" });
    await turn();
    expect(h.chatJson).toHaveBeenCalledTimes(1);
    expect(h.silences).toHaveLength(0);
  });

  it("ventana de 24 h cerrada (la reacción la tomó un turno ya programado): no hay handoff «ventana»", async () => {
    const closed = { ...conv, lastInboundAt: new Date(Date.now() - 30 * 3_600_000) };
    arrange({ conv: closed, desc: [reaction("r15", 30, { reactionToId: "q1" }), question] });
    await turn();
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.events).toEqual([]);
    expect(h.sent).toHaveLength(0);
    expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed", reaction: { id: "r15" } });
  });

  it("la ventana vence durante el debounce de la reacción (temporizador real): sin handoff", async () => {
    vi.useFakeTimers();
    try {
      const { scheduleAgentTurn } = await import("@/server/ai/pipeline");
      const closed = { ...conv, lastInboundAt: new Date(Date.now() - 25 * 3_600_000) };
      arrange({ conv: closed, desc: [reaction("r16", 30, { reactionToId: "q1" }), question] });
      scheduleAgentTurn("cv_1", 100);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(h.chatJson).not.toHaveBeenCalled();
      expect(h.events).toEqual([]);
      expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed", reaction: { id: "r16" } });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("ráfaga: 👍 a la pregunta de la IA y luego ❤️ al mensaje del equipo: el turno atiende el 👍 (no se silencia)", async () => {
    h.lastTeamAt = t(0);
    const team = msg({ id: "t1", direction: "out", type: "text", source: "phone", text: "Hola, te cotizo", createdAt: t(0) });
    const aiQuestion = msg({ id: "q2", direction: "out", type: "text", aiGenerated: true, text: "¿Te busco?", createdAt: t(20) });
    arrange({
      desc: [reaction("r_b", 26, { reactionToId: "t1" }), reaction("r_a", 25, { reactionToId: "q2" }), aiQuestion, team],
    });
    h.chatJson.mockResolvedValue({ ok: true, data: { action: "reply", text: "Perfecto, te paso las opciones de fechas." }, raw: "{}" });
    await turn();
    expect(h.chatJson).toHaveBeenCalledTimes(1);
    expect(h.silences).toHaveLength(0);
    expect(h.sent).toEqual(["Perfecto, te paso las opciones de fechas."]);
  });

  it("👍 a una respuesta humana anterior con 10 difusiones posteriores (lastTeamAt = null): se silencia igual", async () => {
    // lastTeamMessageAt solo mira los últimos 10 mensajes del equipo: todos difusiones → null.
    h.lastTeamAt = null;
    const human = msg({ id: "t_human", direction: "out", type: "text", source: "phone", text: "Te cotizo", createdAt: t(0) });
    const broadcasts = Array.from({ length: 10 }, (_, i) =>
      msg({ id: `b${i}`, direction: "out", type: "text", source: "phone", text: "Se liberó 👇", details: { broadcast: true }, createdAt: t(10 + i) })
    );
    arrange({ desc: [reaction("r20", 40, { reactionToId: "t_human" }), ...broadcasts.reverse()] });
    h.byId = [human]; // fuera de los últimos 20
    await turn();
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed", reaction: { id: "r20" } });
  });

  describe("retoma: acuse escrito + 👍 a una pregunta anterior de la IA (ambos órdenes de llegada)", () => {
    const setup = () => {
      h.lastTeamAt = t(0);
      return {
        aiQ: msg({ id: "q0", direction: "out", type: "text", aiGenerated: true, text: "¿Te busco del 05/01?", createdAt: t(-5) }),
        team: msg({ id: "t1", direction: "out", type: "text", source: "phone", text: "Un momento", createdAt: t(0) }),
        ok: (mins: number) => msg({ id: "m_ok", direction: "in", type: "text", text: "ok", createdAt: t(mins) }),
      };
    };

    it("«ok» y después 👍", async () => {
      const s = setup();
      arrange({ desc: [reaction("r21", 2, { reactionToId: "q0" }), s.ok(1), s.team, s.aiQ] });
      h.chatJson.mockResolvedValue({ ok: true, data: { action: "reply", text: "Perfecto, te paso las opciones de fechas." }, raw: "{}" });
      await turn();
      expect(h.chatJson).toHaveBeenCalledTimes(1);
      expect(h.silences).toHaveLength(0);
    });

    it("👍 y después «ok»", async () => {
      const s = setup();
      arrange({ desc: [s.ok(2), reaction("r22", 1, { reactionToId: "q0" }), s.team, s.aiQ] });
      h.chatJson.mockResolvedValue({ ok: true, data: { action: "reply", text: "Perfecto, te paso las opciones de fechas." }, raw: "{}" });
      await turn();
      expect(h.chatJson).toHaveBeenCalledTimes(1);
      expect(h.silences).toHaveLength(0);
    });

    it("control: «ok» y 👍 AL EQUIPO → se silencia", async () => {
      const s = setup();
      arrange({ desc: [s.ok(2), reaction("r23", 1, { reactionToId: "t1" }), s.team, s.aiQ] });
      await turn();
      expect(h.chatJson).not.toHaveBeenCalled();
      expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed" });
    });
  });

  it("ráfaga con TODAS las reacciones al equipo: se silencia", async () => {
    h.lastTeamAt = t(0);
    const team = msg({ id: "t1", direction: "out", type: "text", source: "phone", text: "Hola, te cotizo", createdAt: t(0) });
    arrange({ desc: [reaction("r_d", 14, { reactionToId: "t1" }), reaction("r_c", 13, { reactionToId: "t1" }), team] });
    await turn();
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed", reaction: { id: "r_d" } });
  });

  it("salió una plantilla automática durante el debounce: la reacción deja su línea", async () => {
    const auto = msg({ id: "tpl1", direction: "out", type: "template", text: "Recordatorio", createdAt: t(20) });
    arrange({ desc: [auto, reaction("r17", 12, { reactionToId: "q1" }), question] });
    await turn();
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed", reaction: { id: "r17" } });
  });

  it("retoma: la ventana de 24 h vence mientras se espera: la reacción deja su línea", async () => {
    h.lastTeamAt = t(0);
    const team = msg({ id: "t1", direction: "out", type: "text", source: "phone", text: "Hola", createdAt: t(0) });
    const closed = { ...conv, lastInboundAt: new Date(Date.now() - 30 * 3_600_000) };
    arrange({ conv: closed, desc: [reaction("r18", 5), team] });
    await turn();
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.events).toEqual([]);
    expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed", reaction: { id: "r18" } });
  });

  it("la reacción quedó fuera de los últimos 20 mensajes (ya no hay entrantes en el historial): deja su línea", async () => {
    arrange({ desc: [question] });
    h.latestIn = [reaction("r19", 1)];
    await turn();
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed", reaction: { id: "r19" } });
  });

  it("el mensaje reaccionado quedó FUERA de los últimos 20: se busca por id y se silencia igual", async () => {
    h.lastTeamAt = t(0);
    const team = msg({ id: "t_old", direction: "out", type: "text", source: "phone", text: "Hola, te cotizo", createdAt: t(0) });
    const aiQuestion = msg({ id: "q2", direction: "out", type: "text", aiGenerated: true, text: "¿Te busco?", createdAt: t(20) });
    arrange({ desc: [reaction("r11", 25, { reactionToId: "t_old" }), aiQuestion] }); // t_old no está en el historial
    h.byId = [team];
    await turn();
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed", reaction: { id: "r11" } });
  });

  it("difusión ANTIGUA sin marca, con un mensaje humano posterior: la clasificación (036) la detecta y responde el modelo", async () => {
    // lastTeamAt es el mensaje humano posterior; la difusión vieja nunca fue marcada.
    h.lastTeamAt = t(10);
    const oldBroadcast = msg({ id: "b_old", direction: "out", type: "text", source: "phone", text: "Se me liberó este 👇", createdAt: t(0) });
    const aiQuestion = msg({ id: "q3", direction: "out", type: "text", aiGenerated: true, text: "¿Te interesa?", createdAt: t(20) });
    arrange({ desc: [reaction("r12", 25, { reactionToId: "b_old" }), aiQuestion] });
    h.byId = [oldBroadcast];
    h.detectedBroadcast = true;
    h.chatJson.mockResolvedValue({ ok: true, data: { action: "reply", text: "¡Sí! Te cuento." }, raw: "{}" });
    await turn();
    expect(h.chatJson).toHaveBeenCalledTimes(1);
    expect(h.silences).toHaveLength(0);
    expect(h.sent).toEqual(["¡Sí! Te cuento."]);
  });

  it("👍 a una DIFUSIÓN del equipo (036): no cuenta como confirmación, responde el modelo", async () => {
    // lastTeamMessageAt ya excluye la difusión: no hay «equipo atendiendo».
    h.lastTeamAt = null;
    const broadcast = msg({
      id: "b1",
      direction: "out",
      type: "text",
      source: "phone",
      text: "Se me liberó este 👇",
      details: { broadcast: true },
      createdAt: t(0),
    });
    arrange({ desc: [reaction("r10", 3, { reactionToId: "b1" }), broadcast] });
    h.chatJson.mockResolvedValue({ ok: true, data: { action: "reply", text: "¡Sí! Te cuento los detalles." }, raw: "{}" });
    await turn();
    expect(h.chatJson).toHaveBeenCalledTimes(1);
    expect(h.silences).toHaveLength(0);
    expect(h.sent).toEqual(["¡Sí! Te cuento los detalles."]);
  });

  it("standby con un turno pendiente: la reacción de standby calla al agente (misma regla que mensajes)", async () => {
    arrange({ desc: [reaction("r2", 2, { standby: true }), typed, question] });
    await turn();
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.silences[0]).toMatchObject({ reason: "standby", reaction: { id: "r2" } });
  });

  it("contacto conocido (known_contact): la traza lleva la reacción de ESTE turno", async () => {
    arrange({
      contact: contact(new Date("2026-09-25")),
      profile: profile({ sharedPersonalNumber: true }),
      desc: [reaction("r3", 3), question],
    });
    await turn();
    expect(h.chatJson).not.toHaveBeenCalled();
    expect(h.silences[0]).toMatchObject({ reason: "known_contact", reaction: { id: "r3" } });
  });

  it("opted_out: también deja su traza con la reacción", async () => {
    arrange({
      contact: { ...contact(), optedOutAt: new Date(), optedOutSource: "keyword" },
      desc: [reaction("r4", 4), question],
    });
    await turn();
    expect(h.silences[0]).toMatchObject({ reason: "opted_out", reaction: { id: "r4" } });
  });

  it("update_lead sin reply: la reacción no termina sin traza", async () => {
    arrange({ desc: [reaction("r5", 5), question] });
    h.chatJson.mockResolvedValue({ ok: true, data: { action: "update_lead" }, raw: "{}" });
    await turn();
    expect(h.sent).toHaveLength(0);
    expect(h.silences).toHaveLength(1);
    expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed", reaction: { id: "r5" } });
  });

  it("move_stage sin reply: la reacción no termina sin traza", async () => {
    arrange({ desc: [reaction("r6", 6), question] });
    h.chatJson.mockResolvedValue({ ok: true, data: { action: "move_stage", stage: "Interesado" }, raw: "{}" });
    await turn();
    expect(h.sent).toHaveLength(0);
    expect(h.silences).toHaveLength(1);
    expect(h.silences[0]).toMatchObject({ reason: "no_reply_needed", reaction: { id: "r6" } });
  });

  it("una reacción 👍 a la pregunta del agente: el modelo la ve como [REACCIÓN] y la respuesta sale", async () => {
    arrange({ desc: [reaction("r7", 7), question] });
    h.chatJson.mockResolvedValue({ ok: true, data: { action: "reply", text: "Perfecto, te paso las opciones." }, raw: "{}" });
    await turn();
    expect(userMessagesOf(0).some((c) => c.startsWith("[REACCIÓN]") && c.includes("👍"))).toBe(true);
    expect(h.sent).toEqual(["Perfecto, te paso las opciones."]);
  });
});

describe("CRM-5: reacción durante la generación", () => {
  it("exactamente una regeneración (por el temporizador real) y una sola respuesta", async () => {
    vi.useFakeTimers();
    try {
      const { scheduleAgentTurn } = await import("@/server/ai/pipeline");
      arrange({ desc: [typed, question] });
      let calls = 0;
      h.chatJson.mockImplementation(() => {
        calls++;
        if (calls === 1) {
          // Mientras el agente genera para m1, llega la reacción r2.
          const r2 = reaction("r2", 2);
          h.latestIn = [r2];
          h.history = [r2, typed, question];
          h.recent = [r2, typed, question];
          h.tables = {
            conversation: [[conv]],
            contact: [[contact()]],
            agentProfile: [[profile()]],
          };
        }
        return Promise.resolve({ ok: true, data: { action: "reply", text: `Respuesta ${calls}` }, raw: "{}" });
      });
      scheduleAgentTurn("cv_1", 100);
      await vi.advanceTimersByTimeAsync(100); // turno 1: queda viejo (llegó r2)
      expect(h.sent).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(100); // la regeneración: toma la reacción
      await vi.advanceTimersByTimeAsync(5_000); // nada más se reprograma
      expect(h.chatJson).toHaveBeenCalledTimes(2);
      expect(h.sent).toEqual(["Respuesta 2"]);
      expect(userMessagesOf(1).some((c) => c.startsWith("[REACCIÓN]"))).toBe(true);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
