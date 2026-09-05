import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { schema } from "@/lib/db";
import { seedDemo } from "@/server/seed/demo";

/**
 * FR-005 (research D6): la limpieza previa del seed demo busca contactos por
 * teléfono — SIEMPRE filtrando además por organization_id. Sin ese scope,
 * recargar la demo en una empresa borraría contactos reales de otra que
 * casualmente use los mismos números (bug destructivo cross-tenant).
 */

type CapturedSelect = { table: unknown; cond: unknown };

function makeStubDb(captured: CapturedSelect[]) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          captured.push({ table, cond });
          if (table === schema.pipelineStage) {
            // una etapa alcanza como fallback para el resto del seed
            return Promise.resolve([
              { id: "stg_1", name: "Nuevo", position: 0, kind: "open" },
            ]);
          }
          return Promise.resolve([]);
        },
      }),
    }),
    insert: () => ({ values: () => Promise.resolve() }),
    delete: () => ({ where: () => Promise.resolve() }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
}

describe("seedDemo scoped por organización", () => {
  it("la búsqueda de contactos demo previos filtra por organization_id Y teléfono", async () => {
    const captured: CapturedSelect[] = [];
    const db = makeStubDb(captured) as unknown as Parameters<typeof seedDemo>[0];

    await seedDemo(db, "org_a");

    const contactSelect = captured.find((c) => c.table === schema.contact);
    expect(contactSelect).toBeDefined();
    const query = new PgDialect().sqlToQuery(contactSelect!.cond as SQL);
    expect(query.sql).toContain("organization_id");
    expect(query.sql).toContain("phone");
    expect(query.sql.toLowerCase()).toContain("and");
    expect(query.params).toContain("org_a");
  });
});
