import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";

/**
 * T015 (US2): ruteo del webhook con DOS organizaciones conectadas.
 *
 * getCredentialsByPhoneNumberId es el ÚNICO punto de resolución de org para
 * field=messages (el wa-mock entrega por el mismo webhook HTTP → paridad de
 * camino), y meta_credentials_phone_uq hace el ruteo no ambiguo a nivel
 * instancia. Este test verifica con las funciones REALES (BD stub) que:
 *   1. el lookup por phone_number_id resuelve la org dueña de CADA número;
 *   2. TODA la ingesta (contacto, conversación, mensaje, lead) y TODOS los
 *      eventos SSE del mensaje aterrizan en la org resuelta — jamás en la otra;
 *   3. la dedup de ingesta es por (organization_id, wa_message_id);
 *   4. los estados de mensaje se buscan scoped por la org resuelta;
 *   5. un phone_number_id desconocido se ignora sin efectos.
 */

const state = vi.hoisted(() => ({
  credRows: [] as Record<string, unknown>[],
  inserted: [] as { table: unknown; values: Record<string, unknown> }[],
  conflictTargets: [] as { table: unknown; target: unknown[] | undefined }[],
  selects: [] as { table: unknown; sql: string; params: unknown[] }[],
  published: [] as { organizationId: string; type: string }[],
  agentTurns: [] as string[],
}));

vi.mock("@/server/events/bus", () => ({
  publish: (organizationId: string, event: { type: string }) => {
    state.published.push({ organizationId, type: event.type });
  },
  subscribe: () => () => {},
}));

vi.mock("@/server/ai/trigger", () => ({
  // US3: el trigger recibe la organización (gate de config por empresa).
  maybeRunAgentTurn: (organizationId: string, conversationId: string) => {
    state.agentTurns.push(`${organizationId}:${conversationId}`);
    return Promise.resolve();
  },
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const schema = actual.schema;
  // referencia solo de tipo: se borra en compilación (no rompe el hoisting)
  const render = (cond: unknown) => new PgDialect().sqlToQuery(cond as SQL);

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const q = render(cond);
          state.selects.push({ table, sql: q.sql, params: q.params });
          if (table === schema.metaCredentials) {
            // simula el índice único: devuelve la fila de ESE phone_number_id
            const row = state.credRows.find((r) =>
              q.params.includes(r.phoneNumberId)
            );
            return { limit: () => Promise.resolve(row ? [row] : []) };
          }
          if (table === schema.pipelineStage) {
            return {
              orderBy: () => ({
                limit: () => Promise.resolve([{ id: "stg_1" }]),
              }),
            };
          }
          if (table === schema.lead) {
            return {
              // lead existente: no hay (se crea); maxPos: tabla vacía
              limit: () => Promise.resolve([]),
              then: (resolve: (v: unknown) => void) => resolve([{ max: -1 }]),
            };
          }
          // contact/conversation fallback y message (estados): sin filas
          return { limit: () => Promise.resolve([]) };
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        state.inserted.push({ table, values });
        return {
          onConflictDoNothing: (opts?: { target?: unknown[] }) => {
            state.conflictTargets.push({ table, target: opts?.target });
            return {
              returning: () => Promise.resolve([values]),
              then: (resolve: (v: unknown) => void) => resolve(undefined),
            };
          },
        };
      },
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
  };
  return { ...actual, getDb: () => db };
});

beforeAll(async () => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";

  const { encryptSecret } = await import("@/lib/crypto");
  const makeCred = (org: string, waba: string, phone: string) => {
    const enc = encryptSecret(`token-${org}`);
    return {
      id: `cred_${org}`,
      organizationId: org,
      wabaId: waba,
      phoneNumberId: phone,
      displayPhoneNumber: `+52 55 ${phone}`,
      verifiedName: org,
      status: "connected",
      tokenCipher: enc.cipher,
      tokenIv: enc.iv,
      tokenTag: enc.tag,
    };
  };
  state.credRows.push(
    makeCred("org_a", "waba_a", "pn_a"),
    makeCred("org_b", "waba_b", "pn_b")
  );
});

beforeEach(() => {
  state.inserted.length = 0;
  state.conflictTargets.length = 0;
  state.selects.length = 0;
  state.published.length = 0;
  state.agentTurns.length = 0;
});

describe("T015: lookup de credenciales por phone_number_id con 2 orgs", () => {
  it("cada número resuelve a SU organización; desconocido → null", async () => {
    const { getCredentialsByPhoneNumberId } = await import(
      "@/server/whatsapp/credentials"
    );
    const a = await getCredentialsByPhoneNumberId("pn_a");
    const b = await getCredentialsByPhoneNumberId("pn_b");
    const x = await getCredentialsByPhoneNumberId("pn_desconocido");

    expect(a?.organizationId).toBe("org_a");
    expect(a?.token).toBe("token-org_a");
    expect(b?.organizationId).toBe("org_b");
    expect(b?.token).toBe("token-org_b");
    expect(x).toBeNull();

    // el WHERE real filtra por la columna phone_number_id
    const schema = (await import("@/lib/db")).schema;
    const credSelects = state.selects.filter(
      (s) => s.table === schema.metaCredentials
    );
    expect(credSelects).toHaveLength(3);
    for (const s of credSelects) expect(s.sql).toContain("phone_number_id");
  });
});

describe("T015: processMessagesValue enruta la ingesta completa a la org dueña", () => {
  async function ingest(phoneNumberId: string, waMessageId: string) {
    const { processMessagesValue } = await import("@/server/inbox/ingest");
    await processMessagesValue({
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: "5215550001", profile: { name: "Cliente" } }],
      messages: [
        {
          from: "5215550001",
          id: waMessageId,
          timestamp: "1725500000",
          type: "text",
          text: { body: "hola, ¿tienen stock?" },
        },
      ],
    });
  }

  it("mensaje al número de B → contacto, conversación, mensaje y lead SOLO en org_b", async () => {
    await ingest("pn_b", "wamid.test.1");
    expect(state.inserted.length).toBeGreaterThanOrEqual(4);
    for (const { values } of state.inserted) {
      expect(values.organizationId).toBe("org_b");
    }
    // los eventos SSE van al canal de org_b — ninguno al de org_a
    expect(state.published.length).toBeGreaterThanOrEqual(2);
    for (const p of state.published) expect(p.organizationId).toBe("org_b");
    expect(state.agentTurns).toHaveLength(1);
    // el gate del agente se evalúa con la org resuelta (config de IA de B)
    expect(state.agentTurns[0]).toMatch(/^org_b:/);
  });

  it("el MISMO wamid al número de A → aterriza en org_a (dedup por tenant, no global)", async () => {
    await ingest("pn_a", "wamid.test.1");
    for (const { values } of state.inserted) {
      expect(values.organizationId).toBe("org_a");
    }
    for (const p of state.published) expect(p.organizationId).toBe("org_a");

    // contrato de dedup: el conflict target del mensaje es (org, wamid)
    const schema = (await import("@/lib/db")).schema;
    const msgConflict = state.conflictTargets.find(
      (c) => c.table === schema.message
    );
    expect(msgConflict?.target).toContain(schema.message.organizationId);
    expect(msgConflict?.target).toContain(schema.message.waMessageId);
  });

  it("phone_number_id desconocido → se ignora sin efectos ni eventos", async () => {
    await ingest("pn_fantasma", "wamid.test.2");
    expect(state.inserted).toHaveLength(0);
    expect(state.published).toHaveLength(0);
    expect(state.agentTurns).toHaveLength(0);
  });

  it("estados de mensaje: la búsqueda va scoped por la org resuelta", async () => {
    const { processMessagesValue } = await import("@/server/inbox/ingest");
    await processMessagesValue({
      metadata: { phone_number_id: "pn_b" },
      statuses: [
        { id: "wamid.out.9", status: "delivered", timestamp: "1725500100" },
      ],
    });
    const schema = (await import("@/lib/db")).schema;
    const msgSelect = state.selects.find((s) => s.table === schema.message);
    expect(msgSelect).toBeDefined();
    expect(msgSelect!.sql).toContain("organization_id");
    expect(msgSelect!.params).toContain("org_b");
    expect(msgSelect!.params).toContain("wamid.out.9");
  });
});
