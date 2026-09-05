import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";

/**
 * US3 (contrato ai-settings.md): la config de IA por empresa se guarda
 * cifrada (jamás texto plano en la fila), todo acceso va scoped por
 * organización, y getAiConfig aplica los defaults de producto.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  inserted: [] as Row[],
  wheres: [] as { sql: string; params: unknown[] }[],
  deletes: [] as { sql: string; params: unknown[] }[],
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const render = (cond: unknown) =>
    new PgDialect().sqlToQuery(cond as SQL);
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: (cond: unknown) => {
            const q = render(cond);
            state.wheres.push({ sql: q.sql, params: q.params });
            return {
              limit: () =>
                Promise.resolve(
                  state.rows.filter((r) =>
                    q.params.includes(r.organizationId)
                  )
                ),
            };
          },
        }),
      }),
      insert: () => ({
        values: (v: Row) => {
          state.inserted.push(v);
          return { onConflictDoUpdate: () => Promise.resolve() };
        },
      }),
      delete: () => ({
        where: (cond: unknown) => {
          const q = render(cond);
          state.deletes.push({ sql: q.sql, params: q.params });
          return Promise.resolve();
        },
      }),
    }),
  };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

beforeEach(() => {
  state.rows.length = 0;
  state.inserted.length = 0;
  state.wheres.length = 0;
  state.deletes.length = 0;
});

async function seedRow(
  organizationId: string,
  token: string,
  model: string | null = null,
  judgeModel: string | null = null
) {
  const { encryptSecret } = await import("@/lib/crypto");
  const enc = encryptSecret(token);
  state.rows.push({
    id: `aic_${organizationId}`,
    organizationId,
    tokenCipher: enc.cipher,
    tokenIv: enc.iv,
    tokenTag: enc.tag,
    model,
    judgeModel,
  });
}

describe("config de IA por empresa (US3)", () => {
  it("saveAiConfig cifra el token: la fila no contiene el texto plano y es reversible", async () => {
    const { saveAiConfig } = await import("@/server/ai/credentials");
    const token = "sk-or-token-super-secreto-wxyz";
    await saveAiConfig({ organizationId: "org_1", token });

    const row = state.inserted[0]!;
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.tokenCipher).toBeTruthy();
    expect(row.tokenIv).toBeTruthy();
    expect(row.tokenTag).toBeTruthy();
    expect(String(row.id)).toMatch(/^aic_/);

    const { decryptSecret } = await import("@/lib/crypto");
    expect(
      decryptSecret({
        cipher: row.tokenCipher as string,
        iv: row.tokenIv as string,
        tag: row.tokenTag as string,
      })
    ).toBe(token);
  });

  it("round-trip completo: lo guardado se recupera descifrado vía getAiConfig", async () => {
    const { getAiConfig } = await import("@/server/ai/credentials");
    await seedRow("org_1", "sk-or-mi-token-abcd", "openai/gpt-5", "z/juez");
    const config = await getAiConfig("org_1");
    expect(config).toEqual({
      token: "sk-or-mi-token-abcd",
      model: "openai/gpt-5",
      judgeModel: "z/juez",
    });
  });

  it("getAiConfig aplica los defaults de producto cuando la empresa no eligió modelos", async () => {
    const { getAiConfig, DEFAULT_AGENT_MODEL, DEFAULT_JUDGE_MODEL } =
      await import("@/server/ai/credentials");
    await seedRow("org_1", "sk-or-token");
    const config = await getAiConfig("org_1");
    expect(config?.model).toBe(DEFAULT_AGENT_MODEL);
    expect(config?.judgeModel).toBe(DEFAULT_JUDGE_MODEL);
  });

  it("juez sin configurar pero agente con modelo propio → el juez sigue al agente", async () => {
    const { getAiConfig } = await import("@/server/ai/credentials");
    await seedRow("org_1", "sk-or-token", "openai/gpt-5", null);
    const config = await getAiConfig("org_1");
    expect(config?.judgeModel).toBe("openai/gpt-5");
  });

  it("empresa sin config → null (agente apagado) e isAiConfigured false", async () => {
    const { getAiConfig, isAiConfigured } = await import(
      "@/server/ai/credentials"
    );
    expect(await getAiConfig("org_sin")).toBeNull();
    expect(await isAiConfigured("org_sin")).toBe(false);
  });

  it("scoping: toda lectura y el borrado filtran por organization_id", async () => {
    const { getAiConfig, deleteAiConfig } = await import(
      "@/server/ai/credentials"
    );
    await seedRow("org_a", "token-de-a");
    await seedRow("org_b", "token-de-b");

    const config = await getAiConfig("org_a");
    expect(config?.token).toBe("token-de-a");
    expect(state.wheres[0]!.sql).toContain("organization_id");
    expect(state.wheres[0]!.params).toEqual(["org_a"]);

    await deleteAiConfig("org_b");
    expect(state.deletes[0]!.sql).toContain("organization_id");
    expect(state.deletes[0]!.params).toEqual(["org_b"]);
  });

  it("getAiSettings expone solo last4 y modelos crudos (jamás el token)", async () => {
    const { getAiSettings } = await import("@/server/ai/credentials");
    await seedRow("org_1", "sk-or-token-secreto-qrst", null, null);
    const settings = await getAiSettings("org_1");
    expect(settings).toEqual({
      tokenLast4: "qrst",
      model: null,
      judgeModel: null,
    });
    expect(JSON.stringify(settings)).not.toContain("sk-or-token-secreto");
  });

  it("scoped() rechaza organizationId vacío (query sin tenant no compila natural)", async () => {
    const { getAiConfig } = await import("@/server/ai/credentials");
    await expect(getAiConfig("")).rejects.toThrow(/organizationId vacío/);
  });
});
