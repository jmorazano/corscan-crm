import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Etiquetas en el servidor (006): el WHERE del filtro multi-etiqueta y la
 * operación en bloque. Lo que se protege: (1) `any` es OR de contains y
 * `all` es un contains del juego completo; (2) el bulk solo escribe las
 * filas que cambian, siempre scoped por organización, y los ids que no
 * aparecen en la org no cuentan.
 */

type UpdateCall = { table: string; set: Record<string, unknown>; where: unknown };
const updateCalls: UpdateCall[] = [];
const selectCalls: { where: unknown }[] = [];
let selectReturns: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => {
  const dbLike = {
    select: () => ({
      from: () => ({
        where: (where: unknown) => {
          selectCalls.push({ where });
          return Promise.resolve(selectReturns);
        },
      }),
    }),
    update: (table: { __name: string }) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: unknown) => {
          updateCalls.push({ table: table.__name, set, where });
          return Promise.resolve();
        },
      }),
    }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(dbLike),
  };
  return {
    getDb: () => dbLike,
    schema: {
      contact: {
        __name: "contact",
        id: "contact.id",
        organizationId: "contact.organization_id",
        tags: "contact.tags",
        isTest: "contact.is_test",
        updatedAt: "contact.updated_at",
      },
      conversation: {
        __name: "conversation",
        id: "conversation.id",
        organizationId: "conversation.organization_id",
        tags: "conversation.tags",
        isTest: "conversation.is_test",
        updatedAt: "conversation.updated_at",
      },
    },
  };
});

beforeEach(() => {
  vi.resetModules();
  updateCalls.length = 0;
  selectCalls.length = 0;
  selectReturns = [];
});

describe("tagsWhere", () => {
  it("sin etiquetas → sin condición", async () => {
    const { tagsWhere } = await import("@/server/tags");
    const { contact } = await import("@/lib/db/schema");
    expect(tagsWhere(contact.tags, [], "any")).toBeUndefined();
    expect(tagsWhere(contact.tags, [" ", ""], "all")).toBeUndefined();
  });

  it("any con varias → OR de contains unitarios; all → un contains del juego", async () => {
    const { tagsWhere } = await import("@/server/tags");
    const { contact } = await import("@/lib/db/schema");
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialect = new PgDialect();
    const anyQ = dialect.sqlToQuery(tagsWhere(contact.tags, ["vip", "cba"], "any")!);
    const allQ = dialect.sqlToQuery(tagsWhere(contact.tags, ["vip", "cba"], "all")!);
    expect(anyQ.sql).toMatch(/@>.* or .*@>/);
    // postgres-js recibe los arrays ya serializados como literales de PG.
    expect(anyQ.params).toEqual(['{"vip"}', '{"cba"}']);
    expect(allQ.sql).not.toContain(" or ");
    expect(allQ.sql).toContain("@>");
    expect(allQ.params).toEqual(['{"vip","cba"}']);
  });
});

describe("bulkUpdateContactTags", () => {
  it("escribe solo las filas cuyo juego cambia y cuenta matched/updated", async () => {
    selectReturns = [
      { id: "ct_1", tags: ["vip"] },
      { id: "ct_2", tags: ["vip", "nuevo"] }, // ya la tiene: no cambia
      { id: "ct_3", tags: [] },
    ];
    const { bulkUpdateContactTags } = await import("@/server/tags");
    const result = await bulkUpdateContactTags(
      "org_1",
      ["ct_1", "ct_2", "ct_3", "ct_ajeno"],
      { add: ["Nuevo"] }
    );
    expect(result.matched).toBe(3);
    expect(result.updated).toBe(2);
    expect(result.updatedIds).toEqual(["ct_1", "ct_3"]);
    expect(updateCalls.map((c) => c.table)).toEqual(["contact", "contact"]);
    expect(updateCalls[0]?.set.tags).toEqual(["vip", "nuevo"]);
    expect(updateCalls[1]?.set.tags).toEqual(["nuevo"]);
  });

  it("quitar una etiqueta ausente no escribe nada (idempotente)", async () => {
    selectReturns = [{ id: "ct_1", tags: ["vip"] }];
    const { bulkUpdateContactTags } = await import("@/server/tags");
    const result = await bulkUpdateContactTags("org_1", ["ct_1"], {
      remove: ["cordoba"],
    });
    expect(result).toEqual({ matched: 1, updated: 0, updatedIds: [] });
    expect(updateCalls).toHaveLength(0);
  });

  it("toda lectura y escritura lleva la organización (Constitución III)", async () => {
    selectReturns = [{ id: "cv_1", tags: [] }];
    const { bulkUpdateConversationTags } = await import("@/server/tags");
    await bulkUpdateConversationTags("org_1", ["cv_1"], { add: ["urgente"] });
    expect(JSON.stringify(selectCalls[0]?.where)).toContain("organization_id");
    expect(JSON.stringify(updateCalls[0]?.where)).toContain("organization_id");
    expect(updateCalls[0]?.table).toBe("conversation");
  });

  it("lista vacía → no toca la BD", async () => {
    const { bulkUpdateContactTags } = await import("@/server/tags");
    const result = await bulkUpdateContactTags("org_1", [], { add: ["x"] });
    expect(result).toEqual({ matched: 0, updated: 0, updatedIds: [] });
    expect(selectCalls).toHaveLength(0);
  });
});

describe("bulkTagsBodySchema", () => {
  it("exige ids y al menos una etiqueta válida en add o remove", async () => {
    const { bulkTagsBodySchema } = await import("@/server/tags");
    expect(bulkTagsBodySchema.safeParse({ ids: [], add: ["a"] }).success).toBe(false);
    expect(
      bulkTagsBodySchema.safeParse({ ids: ["ct_1"], add: [" "], remove: [] }).success
    ).toBe(false);
    expect(bulkTagsBodySchema.safeParse({ ids: ["ct_1"], remove: ["a"] }).success).toBe(
      true
    );
  });
});
