import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import type { WebhookMessage } from "@/server/inbox/webhook";

/**
 * 035: el origen del anuncio en la ingesta REAL de WhatsApp
 * (`processMessagesValue` → `ingestInboundMessage`), con la BD stub del
 * patrón de `webhook-routing-two-orgs.test.ts`. Verifica que:
 *   1. un entrante con `referral` deja `ig_origin` + etiqueta `wa-anuncio`
 *      (scoped por empresa y nunca en el sandbox) y avisa por SSE, ANTES de
 *      insertar el mensaje y de despertar al agente;
 *   2. un referral ilegible no deja origen y el mensaje entra igual;
 *   3. sin referral no se toca el origen;
 *   4. la reentrega del mismo clic y un clic viejo no cambian nada; un
 *      anuncio nuevo sí;
 *   5. si la escritura del origen falla, el mensaje entra igual.
 */

type Op = { kind: string; table?: unknown };

const state = vi.hoisted(() => ({
  credRows: [] as Record<string, unknown>[],
  /** Conversación existente (si no, el insert la "crea"). */
  existingConversation: null as Record<string, unknown> | null,
  /** El mensaje ya existía (reentrega de Meta). */
  duplicateMessage: false,
  failOriginUpdate: false,
  ops: [] as Op[],
  updates: [] as { table: unknown; values: Record<string, unknown>; where: { sql: string; params: unknown[] } }[],
  inserted: [] as { table: unknown; values: Record<string, unknown> }[],
  published: [] as { organizationId: string; type: string; data: unknown }[],
  agentTurns: [] as string[],
}));

vi.mock("@/server/events/bus", () => ({
  publish: (organizationId: string, event: { type: string; data: unknown }) => {
    state.published.push({ organizationId, type: event.type, data: event.data });
    state.ops.push({ kind: `publish:${event.type}` });
  },
  subscribe: () => () => {},
}));

vi.mock("@/server/ai/trigger", () => ({
  maybeRunAgentTurn: (organizationId: string, conversationId: string) => {
    state.agentTurns.push(`${organizationId}:${conversationId}`);
    state.ops.push({ kind: "agent" });
    return Promise.resolve();
  },
}));

// 017: el estado de la importación del historial no es parte de esta prueba.
vi.mock("@/server/whatsapp/history-sync", () => ({
  getHistoryImport: () => Promise.resolve(null),
  recordChunk: () => Promise.resolve(),
  recordDeclined: () => Promise.resolve(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const schema = actual.schema;
  const render = (cond: unknown) => new PgDialect().sqlToQuery(cond as SQL);

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const q = render(cond);
          if (table === schema.metaCredentials) {
            const row = state.credRows.find((r) => q.params.includes(r.phoneNumberId));
            return { limit: () => Promise.resolve(row ? [row] : []) };
          }
          if (table === schema.conversation) {
            return {
              limit: () => Promise.resolve(state.existingConversation ? [state.existingConversation] : []),
            };
          }
          if (table === schema.pipelineStage) {
            return { orderBy: () => ({ limit: () => Promise.resolve([{ id: "stg_1" }]) }) };
          }
          if (table === schema.lead) {
            return {
              limit: () => Promise.resolve([]),
              then: (resolve: (v: unknown) => void) => resolve([{ max: -1 }]),
            };
          }
          return { limit: () => Promise.resolve([]) };
        },
      }),
    }),
    insert: (table: unknown) => ({
      // Un objeto (ingesta) o un lote (historial/ecos de 017).
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        onConflictDoNothing: () => {
          const list = Array.isArray(values) ? values : [values];
          const conflict =
            (table === schema.conversation && state.existingConversation !== null) ||
            (table === schema.message && state.duplicateMessage);
          if (!conflict) {
            for (const v of list) state.inserted.push({ table, values: v });
            state.ops.push({ kind: "insert", table });
          }
          const rows = conflict
            ? []
            : list.map((v) =>
                table === schema.conversation ? { isTest: false, igOrigin: null, tags: [], ...v } : v
              );
          return {
            returning: () => Promise.resolve(rows),
            then: (resolve: (v: unknown) => void) => resolve(undefined),
          };
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          if (table === schema.conversation && "igOrigin" in values) {
            if (state.failOriginUpdate) return Promise.reject(new Error("BD caída"));
            state.ops.push({ kind: "update:origin" });
          }
          const q = render(cond);
          state.updates.push({ table, values, where: { sql: q.sql, params: q.params } });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { ...actual, getDb: () => db };
});

const PHONE_NUMBER_ID = "pn_035";
const ORG = "org_035";
const TS = "1791810000"; // segundos, como lo manda Meta

const REFERRAL = {
  source_url: "https://fb.me/3cr4Wqqkk",
  source_id: "120200000000000",
  source_type: "ad",
  headline: "Relevamiento con dron en Córdoba",
  body: "Mensuras y relevamientos LiDAR para agrimensores.",
  media_type: "image",
  ctwa_clid: "ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0",
};

beforeAll(async () => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";

  const { encryptSecret } = await import("@/lib/crypto");
  const enc = encryptSecret("token-035");
  state.credRows.push({
    id: "cred_035",
    organizationId: ORG,
    wabaId: "waba_035",
    phoneNumberId: PHONE_NUMBER_ID,
    displayPhoneNumber: "+54 9 351 000-0000",
    verifiedName: "CorScan",
    status: "connected",
    tokenCipher: enc.cipher,
    tokenIv: enc.iv,
    tokenTag: enc.tag,
  });
});

beforeEach(() => {
  state.existingConversation = null;
  state.duplicateMessage = false;
  state.failOriginUpdate = false;
  state.ops.length = 0;
  state.updates.length = 0;
  state.inserted.length = 0;
  state.published.length = 0;
  state.agentTurns.length = 0;
});

async function ingest(message: Partial<WebhookMessage>) {
  const { processMessagesValue } = await import("@/server/inbox/ingest");
  await processMessagesValue({
    metadata: { phone_number_id: PHONE_NUMBER_ID },
    contacts: [{ wa_id: "5493515550035", profile: { name: "Agrimensor" } }],
    messages: [
      {
        from: "5493515550035",
        id: "wamid.035.1",
        timestamp: TS,
        type: "text",
        text: { body: "¡Hola! Quiero más información." },
        ...message,
      },
    ],
  });
}

async function schemaOf() {
  return (await import("@/lib/db")).schema;
}

function originUpdates(schema: Awaited<ReturnType<typeof schemaOf>>) {
  return state.updates.filter((u) => u.table === schema.conversation && "igOrigin" in u.values);
}

describe("035 · ingesta de un entrante que llegó por un anuncio", () => {
  it("deja origen + etiqueta wa-anuncio, scoped y fuera del sandbox, antes del mensaje y del agente", async () => {
    await ingest({ referral: REFERRAL });
    const schema = await schemaOf();

    const updates = originUpdates(schema);
    expect(updates).toHaveLength(1);
    const update = updates[0]!;
    expect(update.values.igOrigin).toMatchObject({
      kind: "ad",
      channel: "whatsapp",
      label: "Anuncio: Relevamiento con dron en Córdoba",
      ref: "120200000000000",
      detail: "Relevamiento con dron en Córdoba",
      sourceUrl: "https://fb.me/3cr4Wqqkk",
      clickId: REFERRAL.ctwa_clid,
      at: new Date(Number(TS) * 1000).toISOString(),
    });

    // La etiqueta se suma sin duplicar (misma expresión que Instagram).
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const tags = new PgDialect().sqlToQuery(update.values.tags as SQL);
    expect(tags.sql).toContain("distinct unnest");
    expect(tags.params).toContain("wa-anuncio");

    // Scoped por empresa, por id y jamás sobre el sandbox.
    expect(update.where.sql).toContain('"conversation"."organization_id"');
    expect(update.where.sql).toContain('"conversation"."is_test"');
    expect(update.where.params).toContain(ORG);
    expect(update.where.params).toContain(false);

    // SSE para que la Bandeja se refresque.
    const sse = state.published.find((p) => p.type === "conversations.updated");
    expect(sse?.organizationId).toBe(ORG);
    expect((sse?.data as { conversationIds: string[] }).conversationIds).toHaveLength(1);

    // Orden: origen → mensaje → agente (el turno ya ve el anuncio).
    const kinds = state.ops.map((o) => (o.kind === "insert" && o.table === schema.message ? "insert:message" : o.kind));
    expect(kinds.indexOf("update:origin")).toBeGreaterThan(-1);
    expect(kinds.indexOf("update:origin")).toBeLessThan(kinds.indexOf("insert:message"));
    expect(kinds.indexOf("insert:message")).toBeLessThan(kinds.indexOf("agent"));
    expect(state.agentTurns).toHaveLength(1);
  });

  it("un referral ilegible se ignora y el mensaje entra igual", async () => {
    for (const referral of ["texto", null, 42, [], {}, { headline: 5, source_id: { x: 1 } }]) {
      state.ops.length = 0;
      state.updates.length = 0;
      state.inserted.length = 0;
      state.published.length = 0;
      state.agentTurns.length = 0;
      await ingest({ referral });
      const schema = await schemaOf();
      expect(originUpdates(schema)).toHaveLength(0);
      expect(state.inserted.some((i) => i.table === schema.message)).toBe(true);
      expect(state.published.some((p) => p.type === "conversations.updated")).toBe(false);
      expect(state.published.some((p) => p.type === "message.new")).toBe(true);
      expect(state.agentTurns).toHaveLength(1);
    }
  });

  it("sin referral no se toca el origen", async () => {
    await ingest({});
    const schema = await schemaOf();
    expect(originUpdates(schema)).toHaveLength(0);
    expect(state.published.some((p) => p.type === "conversations.updated")).toBe(false);
  });

  it("la reentrega del mismo clic no repite nada (ni origen ni mensaje)", async () => {
    const { parseWhatsAppReferral, whatsAppAdOrigin } = await import("@/lib/whatsapp-ad-origin");
    state.existingConversation = {
      id: "cv_035",
      organizationId: ORG,
      contactId: "ct_035",
      isTest: false,
      kind: "whatsapp",
      tags: ["wa-anuncio"],
      // Tal como vuelve de la base (jsonb reordena las claves).
      igOrigin: JSON.parse(
        JSON.stringify(whatsAppAdOrigin(parseWhatsAppReferral(REFERRAL)!, new Date(Number(TS) * 1000)))
      ),
    };
    state.duplicateMessage = true;
    await ingest({ referral: REFERRAL });
    const schema = await schemaOf();
    expect(originUpdates(schema)).toHaveLength(0);
    expect(state.inserted.some((i) => i.table === schema.message)).toBe(false);
    expect(state.published).toHaveLength(0);
    expect(state.agentTurns).toHaveLength(0);
  });

  it("un anuncio nuevo reemplaza el origen; uno más viejo que llega tarde, no", async () => {
    const { parseWhatsAppReferral, whatsAppAdOrigin } = await import("@/lib/whatsapp-ad-origin");
    const previous = whatsAppAdOrigin(
      parseWhatsAppReferral({ source_id: "999", headline: "Anuncio viejo", ctwa_clid: "clid-viejo" })!,
      new Date((Number(TS) - 3600) * 1000)
    );
    state.existingConversation = {
      id: "cv_035",
      organizationId: ORG,
      contactId: "ct_035",
      isTest: false,
      kind: "whatsapp",
      tags: ["wa-anuncio"],
      igOrigin: previous,
    };
    await ingest({ id: "wamid.035.2", referral: REFERRAL });
    const schema = await schemaOf();
    const updates = originUpdates(schema);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.values.igOrigin).toMatchObject({ ref: "120200000000000", label: "Anuncio: Relevamiento con dron en Córdoba" });
    expect(updates[0]!.where.params).toContain("cv_035");

    // Al revés: el guardado es MÁS nuevo que el clic que llega → nada.
    state.updates.length = 0;
    state.existingConversation = {
      ...state.existingConversation,
      igOrigin: whatsAppAdOrigin(
        parseWhatsAppReferral({ source_id: "777", headline: "Anuncio nuevo", ctwa_clid: "clid-nuevo" })!,
        new Date((Number(TS) + 3600) * 1000)
      ),
    };
    await ingest({ id: "wamid.035.3", referral: REFERRAL });
    expect(originUpdates(schema)).toHaveLength(0);
  });

  it("si escribir el origen falla, el mensaje entra igual", async () => {
    state.failOriginUpdate = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await ingest({ referral: REFERRAL });
    const schema = await schemaOf();
    expect(state.inserted.some((i) => i.table === schema.message)).toBe(true);
    expect(state.agentTurns).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("[webhook] no se pudo registrar el origen del anuncio:", "BD caída");
    warn.mockRestore();
  });
});

describe("035 · historial y ecos del celular (017) nunca marcan origen", () => {
  const recent = () => String(Math.floor(Date.now() / 1000) - 3600);

  it("eco con referral: el saliente se guarda y la conversación queda sin origen", async () => {
    const { processEchoesValue } = await import("@/server/inbox/history");
    await processEchoesValue({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      message_echoes: [
        {
          from: "5493510000000",
          to: "5493515550036",
          id: "wamid.echo.035",
          timestamp: recent(),
          type: "text",
          text: { body: "Te paso la info del relevamiento" },
          referral: REFERRAL,
        },
      ],
    });
    const schema = await schemaOf();
    expect(state.inserted.some((i) => i.table === schema.message && i.values.waMessageId === "wamid.echo.035")).toBe(true);
    expect(originUpdates(schema)).toHaveLength(0);
    expect(state.agentTurns).toHaveLength(0);
  });

  it("historial con referral: se importa sin origen ni etiqueta", async () => {
    const { processHistoryValue } = await import("@/server/inbox/history");
    await processHistoryValue({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      history: [
        {
          metadata: { phase: 0, chunk_order: 1, progress: 100 },
          threads: [
            {
              id: "5493515550037",
              messages: [
                {
                  from: "5493515550037",
                  id: "wamid.hist.035",
                  timestamp: recent(),
                  type: "text",
                  text: { body: "Hola, vi el anuncio" },
                  referral: REFERRAL,
                  history_context: { status: "READ" },
                },
              ],
            },
          ],
        },
      ],
    });
    const schema = await schemaOf();
    expect(state.inserted.some((i) => i.table === schema.message && i.values.waMessageId === "wamid.hist.035")).toBe(true);
    expect(originUpdates(schema)).toHaveLength(0);
    expect(state.agentTurns).toHaveLength(0);
  });
});

describe("035 · applyWhatsAppAdOrigin", () => {
  it("el sandbox (is_test) nunca se marca", async () => {
    const { applyWhatsAppAdOrigin } = await import("@/server/inbox/ad-origin");
    const { parseWhatsAppReferral } = await import("@/lib/whatsapp-ad-origin");
    const result = await applyWhatsAppAdOrigin({
      organizationId: ORG,
      conversation: { id: "cv_lab", isTest: true, igOrigin: null },
      referral: parseWhatsAppReferral(REFERRAL)!,
      at: new Date(),
    });
    expect(result).toBeNull();
    expect(state.updates).toHaveLength(0);
    expect(state.published).toHaveLength(0);
  });
});
