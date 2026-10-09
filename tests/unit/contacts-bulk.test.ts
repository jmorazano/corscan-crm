import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Selección y borrado en bloque de contactos (033). Lo que se protege:
 * (1) el body exige exactamente una de `ids` o `filter`;
 * (2) «todos los que coinciden» usa el WHERE de la lista (org + filtros +
 *     sin el contacto del entrenador) menos los destildados;
 * (3) si la cantidad confirmada no coincide con la selección actual, NO se
 *     borra nada (409 en la ruta); si coincide, se borra de a tandas.
 */

let selectWhere: unknown = null;
let selectReturns: { id: string }[] = [];
const deleteBatches: string[][] = [];

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return {
    schema,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: (where: unknown) => {
            selectWhere = where;
            return { orderBy: () => Promise.resolve(selectReturns) };
          },
        }),
      }),
    }),
  };
});

vi.mock("@/server/contacts", () => ({
  deleteContacts: (_org: string, ids: string[]) => {
    deleteBatches.push(ids);
    return Promise.resolve({ deletedIds: ids, conversationIds: ids.map((id) => `cv_${id}`) });
  },
}));

beforeEach(() => {
  vi.resetModules();
  selectWhere = null;
  selectReturns = [];
  deleteBatches.length = 0;
});

async function renderWhere(): Promise<{ sql: string; params: unknown[] }> {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  return new PgDialect().sqlToQuery(selectWhere as never);
}

describe("bulkDeleteBodySchema", () => {
  it("exige exactamente uno de ids o filter, y la cantidad confirmada", async () => {
    const { bulkDeleteBodySchema } = await import("@/server/contacts-bulk");
    expect(bulkDeleteBodySchema.safeParse({ ids: ["ct_1"], expectedCount: 1 }).success).toBe(true);
    expect(bulkDeleteBodySchema.safeParse({ filter: {}, expectedCount: 5 }).success).toBe(true);
    expect(bulkDeleteBodySchema.safeParse({ expectedCount: 1 }).success).toBe(false);
    expect(
      bulkDeleteBodySchema.safeParse({ ids: ["ct_1"], filter: {}, expectedCount: 1 }).success
    ).toBe(false);
    expect(bulkDeleteBodySchema.safeParse({ ids: ["ct_1"] }).success).toBe(false);
    expect(bulkDeleteBodySchema.safeParse({ ids: [], expectedCount: 1 }).success).toBe(false);
  });

  it("bulk-tags acepta filter y sigue exigiendo una etiqueta válida", async () => {
    const { bulkContactTagsBodySchema } = await import("@/server/contacts-bulk");
    expect(bulkContactTagsBodySchema.safeParse({ filter: { tags: ["vip"] }, add: ["x"] }).success).toBe(true);
    expect(bulkContactTagsBodySchema.safeParse({ filter: {}, add: [" "] }).success).toBe(false);
    expect(bulkContactTagsBodySchema.safeParse({ ids: ["ct_1"], remove: ["vip"] }).success).toBe(true);
  });
});

describe("resolveContactSelection", () => {
  it("filter → WHERE de la lista (org, búsqueda, archivados, etiquetas, sin entrenador) menos excluidos", async () => {
    selectReturns = [{ id: "ct_1" }];
    const { resolveContactSelection } = await import("@/server/contacts-bulk");
    const ids = await resolveContactSelection("org_1", {
      filter: { q: "ana", tags: ["vip"], mode: "any" },
      excludeIds: ["ct_9"],
    });
    expect(ids).toEqual(["ct_1"]);
    const { sql, params } = await renderWhere();
    expect(sql).toContain('"organization_id"');
    expect(sql).toContain("ilike");
    expect(sql).toContain('"archived_at" is null');
    expect(sql).toContain("@>");
    expect(sql).toMatch(/not .*"id" in/);
    expect(params).toEqual(expect.arrayContaining(["org_1", "%ana%", '{"vip"}', "trainer", "ct_9"]));
  });

  it("filter con archivados no agrega la condición de archivo", async () => {
    const { resolveContactSelection } = await import("@/server/contacts-bulk");
    await resolveContactSelection("org_1", { filter: { archived: true } });
    const { sql } = await renderWhere();
    expect(sql).not.toContain("archived_at");
    expect(sql).toContain('"organization_id"');
  });

  it("ids → solo esos, de la org y nunca el contacto del entrenador", async () => {
    const { resolveContactSelection } = await import("@/server/contacts-bulk");
    await resolveContactSelection("org_1", { ids: ["ct_1", "ct_1", "ct_2"] });
    const { sql, params } = await renderWhere();
    expect(sql).toContain('"organization_id"');
    expect(params).toEqual(["org_1", "ct_1", "ct_2", "trainer"]);
  });
});

describe("bulkDeleteContacts", () => {
  it("si la selección cambió no borra nada", async () => {
    selectReturns = [{ id: "ct_1" }, { id: "ct_2" }, { id: "ct_3" }];
    const { bulkDeleteContacts } = await import("@/server/contacts-bulk");
    const result = await bulkDeleteContacts("org_1", { filter: {} }, 2);
    expect(result).toEqual({ ok: false, reason: "selection_changed", count: 3 });
    expect(deleteBatches).toHaveLength(0);
  });

  it("con la cantidad confirmada borra de a tandas y junta las conversaciones", async () => {
    selectReturns = Array.from({ length: 450 }, (_, i) => ({ id: `ct_${i}` }));
    const { bulkDeleteContacts, BULK_CHUNK } = await import("@/server/contacts-bulk");
    const result = await bulkDeleteContacts("org_1", { filter: { tags: ["masivo"] } }, 450);
    expect(deleteBatches.map((b) => b.length)).toEqual([BULK_CHUNK, BULK_CHUNK, 50]);
    expect(result).toMatchObject({ ok: true, deleted: 450 });
    expect(result.ok && result.conversationIds).toHaveLength(450);
  });
});
