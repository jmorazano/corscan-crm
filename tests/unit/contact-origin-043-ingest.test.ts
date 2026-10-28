import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import type { WebhookMessage } from "@/server/inbox/webhook";

/**
 * 043: etiquetas de origen en el CONTACTO dentro de la ingesta REAL de
 * WhatsApp, con la BD stub de 035. Verifica que:
 *   1. un anuncio aplicado deja `meta-ads-AAAA-MM` + `origin_at` en el
 *      contacto (scoped, nunca sandbox); una reentrega no;
 *   2. una regla por frase etiqueta el mensaje que abre la charla y no uno
 *      en medio de una charla activa;
 *   3. si etiquetar falla, el mensaje entra igual y el agente corre.
 */

type Op = { kind: string; table?: unknown };

const state = vi.hoisted(() => ({
  credRows: [] as Record<string, unknown>[],
  /** Conversación existente (si no, el insert la "crea"). */
  existingConversation: null as Record<string, unknown> | null,
  /** El mensaje ya existía (reentrega de Meta). */
  duplicateMessage: false,
  failOriginUpdate: false,
  failContactUpdate: false,
  originRules: [] as { phrase: string; tag: string; appendMonth: boolean }[],
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
          if (table === schema.contactOriginRule) {
            return { orderBy: () => Promise.resolve(state.originRules) };
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
          if (table === schema.contact && "originAt" in values && state.failContactUpdate) {
            return Promise.reject(new Error("BD caída"));
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

const PHONE_NUMBER_ID = "pn_043";
const ORG = "org_043";
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
  const enc = encryptSecret("token-043");
  state.credRows.push({
    id: "cred_043",
    organizationId: ORG,
    wabaId: "waba_043",
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
  state.failContactUpdate = false;
  state.originRules = [];
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
    contacts: [{ wa_id: "5493515550043", profile: { name: "Agrimensor" } }],
    messages: [
      {
        from: "5493515550043",
        id: "wamid.043.1",
        timestamp: TS,
        type: "text",
        text: { body: "¡Hola! Quiero más información." },
        ...message,
      },
    ],
  });
}


async function originTagUpdates() {
  const { schema } = await import("@/lib/db");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  return state.updates
    .filter((u) => u.table === schema.contact && "originAt" in u.values)
    .map((u) => ({
      tags: dialect.sqlToQuery(u.values.tags as SQL).params,
      originAt: dialect.sqlToQuery(u.values.originAt as SQL).params,
      where: u.where,
    }));
}

const CLICK_AT = new Date(Number(TS) * 1000);

describe("043 · anuncio de Meta → etiqueta en el contacto", () => {
  it("deja meta-ads-AAAA-MM y origin_at, scoped y fuera del sandbox", async () => {
    await ingest({ referral: REFERRAL });
    const updates = await originTagUpdates();
    expect(updates).toHaveLength(1);
    const u = updates[0]!;
    expect(u.tags).toContain(`meta-ads-${CLICK_AT.toISOString().slice(0, 7)}`);
    expect(u.originAt).toContain(CLICK_AT.toISOString());
    expect(u.where.sql).toContain('"contact"."organization_id"');
    expect(u.where.sql).toContain('"contact"."is_test"');
    expect(u.where.params).toContain(ORG);
    expect(state.agentTurns).toHaveLength(1);
  });

  it("la reentrega del mismo clic no vuelve a etiquetar", async () => {
    const { parseWhatsAppReferral, whatsAppAdOrigin } = await import("@/lib/whatsapp-ad-origin");
    state.existingConversation = {
      id: "cv_043",
      organizationId: ORG,
      contactId: "ct_043",
      isTest: false,
      kind: "whatsapp",
      tags: ["wa-anuncio"],
      lastInboundAt: CLICK_AT,
      igOrigin: JSON.parse(JSON.stringify(whatsAppAdOrigin(parseWhatsAppReferral(REFERRAL)!, CLICK_AT))),
    };
    state.duplicateMessage = true;
    await ingest({ referral: REFERRAL });
    expect(await originTagUpdates()).toHaveLength(0);
  });

  it("sin referral ni reglas no se toca el contacto", async () => {
    await ingest({});
    expect(await originTagUpdates()).toHaveLength(0);
  });

  it("si etiquetar falla, el mensaje entra igual y el agente corre", async () => {
    state.failContactUpdate = true;
    await ingest({ referral: REFERRAL });
    const { schema } = await import("@/lib/db");
    expect(state.inserted.some((i) => i.table === schema.message)).toBe(true);
    expect(state.agentTurns).toHaveLength(1);
  });
});

describe("043 · reglas por frase", () => {
  const rule = { phrase: "vi el anuncio en Google", tag: "google-ads", appendMonth: true };

  it("el mensaje que abre la charla se lleva la etiqueta con el mes", async () => {
    state.originRules = [rule];
    await ingest({ text: { body: "Hola, VÍ el anuncio en google y quiero ver el CRM funcionando." } });
    const updates = await originTagUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0]!.tags).toContain(`google-ads-${CLICK_AT.toISOString().slice(0, 7)}`);
  });

  it("en medio de una charla activa no etiqueta; tras 24 h sí", async () => {
    state.originRules = [rule];
    state.existingConversation = {
      id: "cv_043",
      organizationId: ORG,
      contactId: "ct_043",
      isTest: false,
      kind: "whatsapp",
      tags: [],
      igOrigin: null,
      lastInboundAt: new Date(CLICK_AT.getTime() - 60 * 60_000),
    };
    await ingest({ text: { body: "vi el anuncio en Google" } });
    expect(await originTagUpdates()).toHaveLength(0);

    state.existingConversation = {
      ...state.existingConversation,
      lastInboundAt: new Date(CLICK_AT.getTime() - 25 * 60 * 60_000),
    };
    await ingest({ id: "wamid.043.2", text: { body: "vi el anuncio en Google" } });
    expect(await originTagUpdates()).toHaveLength(1);
  });

  it("el sandbox nunca etiqueta", async () => {
    state.originRules = [rule];
    state.existingConversation = {
      id: "cv_test",
      organizationId: ORG,
      contactId: "ct_043",
      isTest: true,
      kind: "whatsapp",
      tags: [],
      igOrigin: null,
      lastInboundAt: null,
    };
    await ingest({ text: { body: "vi el anuncio en Google" } });
    expect(await originTagUpdates()).toHaveLength(0);
  });
});
