import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Constitución III en el camino en segundo plano del agente (US2): las
 * escrituras conducidas por el LLM (move_stage, update_lead, handoff) van
 * SIEMPRE con organization_id en el WHERE. Si cualquier confusión aguas
 * arriba entregara un contactId/conversationId ajeno, la escritura no debe
 * aterrizar jamás en datos de otra organización.
 */

type Captured = { table: unknown; where: unknown };
const capturedUpdates: Captured[] = [];
const capturedSelects: Captured[] = [];

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      update: (table: unknown) => ({
        set: () => ({
          where: (where: unknown) => {
            capturedUpdates.push({ table, where });
            return {
              returning: () => Promise.resolve([]),
              then: (resolve: (v: unknown) => void) => resolve(undefined),
            };
          },
        }),
      }),
      select: (fields: unknown) => ({
        from: (table: unknown) => ({
          where: (where: unknown) => {
            capturedSelects.push({ table, where });
            void fields;
            return {
              limit: () =>
                Promise.resolve([{ id: "ct_1", notes: "nota previa" }]),
            };
          },
        }),
      }),
    }),
  };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

beforeEach(() => {
  capturedUpdates.length = 0;
  capturedSelects.length = 0;
});

function render(cond: unknown) {
  return new PgDialect().sqlToQuery(cond as SQL);
}

describe("escrituras del turno del agente con scope de tenant (US2)", () => {
  it("moveLeadToStage filtra por organization_id ADEMÁS de contact_id", async () => {
    const { moveLeadToStage } = await import("@/server/ai/pipeline");
    await moveLeadToStage("org_a", "ct_ajeno", "stg_1");
    expect(capturedUpdates).toHaveLength(1);
    const q = render(capturedUpdates[0]!.where);
    expect(q.sql).toContain("organization_id");
    expect(q.sql).toContain("contact_id");
    expect(q.params).toContain("org_a");
    expect(q.params).toContain("ct_ajeno");
  });

  it("appendLeadNote lee Y escribe el contacto scoped por organización", async () => {
    const { appendLeadNote } = await import("@/server/ai/pipeline");
    await appendLeadNote("org_a", "ct_1", "quiere 2 unidades");
    expect(capturedSelects).toHaveLength(1);
    expect(capturedUpdates).toHaveLength(1);
    for (const captured of [capturedSelects[0]!, capturedUpdates[0]!]) {
      const q = render(captured.where);
      expect(q.sql).toContain("organization_id");
      expect(q.params).toContain("org_a");
    }
  });

  it("applyHandoff actualiza la conversación scoped por organización", async () => {
    const { applyHandoff } = await import("@/server/ai/pipeline");
    await applyHandoff("cv_1", "org_a", "modelo");
    expect(capturedUpdates).toHaveLength(1);
    const q = render(capturedUpdates[0]!.where);
    expect(q.sql).toContain("organization_id");
    expect(q.params).toContain("org_a");
    expect(q.params).toContain("cv_1");
  });
});

describe("onLeadActivity (webhook en segundo plano) con scope de tenant", () => {
  it("el lead existente se busca y actualiza por organización + contacto", async () => {
    const { onLeadActivity } = await import("@/server/inbox/lead-activity");
    await onLeadActivity("org_a", "ct_1", new Date());
    // primer select: lead por (organization_id, contact_id)
    const sel = render(capturedSelects[0]!.where);
    expect(sel.sql).toContain("organization_id");
    expect(sel.sql).toContain("contact_id");
    expect(sel.params).toContain("org_a");
    // update del lead encontrado: también scoped
    expect(capturedUpdates).toHaveLength(1);
    const upd = render(capturedUpdates[0]!.where);
    expect(upd.sql).toContain("organization_id");
    expect(upd.params).toContain("org_a");
  });
});
