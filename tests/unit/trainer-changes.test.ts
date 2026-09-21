import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainerChangeType } from "@/server/ai/trainer-actions";

/**
 * 015 (D7): resumen legible de cambios (puro) y aplicación sobre una BD
 * simulada — un cambio inválido se descarta sin abortar el resto y cada uno
 * aplicado deja su fila en agent_change.
 */

// BD simulada mínima: cola de selects + capturas de escrituras.
const selectQueue: unknown[][] = [];
const inserts: { table: string; values: Record<string, unknown> }[] = [];
const updates: { table: string; set: Record<string, unknown> }[] = [];
const deletes: { table: string }[] = [];
let deleteResult: unknown[] = [];

function thenable(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit", "onConflictDoNothing"]) {
    chain[m] = () => chain;
  }
  chain.returning = () => Promise.resolve(rows);
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const tableName = (t: unknown) => (t as { __name: string }).__name;

function fakeDb() {
  return {
    select: () => thenable(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table: tableName(table), values });
        return thenable([{ ...values, createdAt: new Date(), updatedAt: new Date() }]);
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ table: tableName(table), set });
        const row = selectQueue.shift()?.[0] ?? {};
        return thenable([{ ...(row as object), ...set }]);
      },
    }),
    delete: (table: unknown) => {
      deletes.push({ table: tableName(table) });
      return thenable(deleteResult);
    },
  };
}

vi.mock("@/lib/db", () => ({
  getDb: () => fakeDb(),
  schema: new Proxy(
    {},
    {
      get: (_t, name) =>
        new Proxy(
          { __name: String(name) },
          { get: (target, col) => (col === "__name" ? target.__name : `${String(name)}.${String(col)}`) }
        ),
    }
  ),
}));

vi.mock("@/server/ai/credentials", () => ({
  isAiConfigured: vi.fn().mockResolvedValue(true),
}));

const ctx = { organizationId: "org_1", conversationId: "cv_t", messageId: "msg_r" };
const kbRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "kb_abc1",
  organizationId: "org_1",
  kind: "qa",
  question: "¿Precio?",
  answer: "100",
  content: null,
  source: "trainer",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe("summarizeChange", () => {
  it("resúmenes por op", async () => {
    const { summarizeChange } = await import("@/server/trainer/changes");
    const snap = {
      id: "kb_1",
      kind: "qa" as const,
      question: "¿Cuál es el precio de mensura?",
      answer: "150 mil",
      content: null,
      source: "trainer" as const,
      createdAt: new Date().toISOString(),
    };
    expect(summarizeChange("kb_add", null, snap)).toBe("Nueva P/R: ¿Cuál es el precio de mensura?");
    expect(summarizeChange("kb_update", snap, { ...snap, answer: "200" })).toContain("Actualizada P/R");
    expect(summarizeChange("kb_delete", snap, null)).toBe("Borrada P/R: ¿Cuál es el precio de mensura?");
    expect(
      summarizeChange(
        "profile_update",
        { field: "tone", value: "Amable" },
        { field: "tone", value: "Amable\n- No usar emojis." }
      )
    ).toBe("Tono: se agregó «No usar emojis.»");
    expect(
      summarizeChange("profile_update", { field: "name", value: "Asistente" }, { field: "name", value: "Ari" })
    ).toBe("Nombre: ahora es «Ari»");
  });
});

describe("applyTrainerChanges", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    inserts.length = 0;
    updates.length = 0;
    deletes.length = 0;
    deleteResult = [];
  });

  it("kb_add válido + kb_add inválido → uno aplicado, uno rechazado, una fila de auditoría", async () => {
    const { applyTrainerChanges } = await import("@/server/trainer/changes");
    const { getDb } = await import("@/lib/db");
    const changes: TrainerChangeType[] = [
      { op: "kb_add", kind: "qa", question: "¿Precio?", answer: "150 mil" },
      { op: "kb_add", kind: "qa", question: "¿Sin respuesta?" },
    ];
    const out = await applyTrainerChanges(getDb(), ctx, changes);
    expect(out.applied).toHaveLength(1);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]!.reason).toContain("pregunta y respuesta");
    const audit = inserts.filter((i) => i.table === "agentChange");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.values).toMatchObject({ op: "kb_add", source: "trainer", messageId: "msg_r" });
    const kb = inserts.find((i) => i.table === "kbEntry");
    expect(kb?.values).toMatchObject({ source: "trainer", question: "¿Precio?" });
  });

  it("kb_update restaura coherencia: content sobre una P/R → rechazado", async () => {
    const { applyTrainerChanges } = await import("@/server/trainer/changes");
    const { getDb } = await import("@/lib/db");
    selectQueue.push([kbRow()]); // getEntry
    const out = await applyTrainerChanges(getDb(), ctx, [
      { op: "kb_update", id: "kb_abc1", content: "bloque" },
    ]);
    expect(out.applied).toHaveLength(0);
    expect(out.rejected[0]!.reason).toContain("no lleva bloque");
  });

  it("kb_delete guarda el before para poder deshacer", async () => {
    const { applyTrainerChanges } = await import("@/server/trainer/changes");
    const { getDb } = await import("@/lib/db");
    deleteResult = [kbRow()];
    const out = await applyTrainerChanges(getDb(), ctx, [{ op: "kb_delete", id: "kb_abc1" }]);
    expect(out.applied[0]).toMatchObject({ op: "kb_delete", targetId: "kb_abc1" });
    const audit = inserts.find((i) => i.table === "agentChange")!;
    expect((audit.values.before as { question: string }).question).toBe("¿Precio?");
    expect(audit.values.after).toBeNull();
  });

  it("profile_append agrega la línea y registra before/after del campo", async () => {
    const { applyTrainerChanges } = await import("@/server/trainer/changes");
    const { getDb } = await import("@/lib/db");
    const profile = { id: "agp_1", organizationId: "org_1", name: "Ari", tone: "Amable", enabled: true };
    selectQueue.push([profile]); // getProfile (applyOne)
    selectQueue.push([profile]); // getProfile (updateProfile.before)
    selectQueue.push([profile]); // fila base para el update
    const out = await applyTrainerChanges(getDb(), ctx, [
      { op: "profile_append", field: "tone", text: "No usar emojis." },
    ]);
    expect(out.applied[0]!.summary).toBe("Tono: se agregó «No usar emojis.»");
    const upd = updates.find((u) => u.table === "agentProfile")!;
    expect(upd.set.tone).toBe("Amable\n- No usar emojis.");
  });

  it("un cambio ya aplicado (misma línea) se rechaza sin escribir", async () => {
    const { applyTrainerChanges } = await import("@/server/trainer/changes");
    const { getDb } = await import("@/lib/db");
    const profile = { id: "agp_1", organizationId: "org_1", name: "Ari", tone: "Amable\n- No usar emojis." };
    selectQueue.push([profile]);
    const out = await applyTrainerChanges(getDb(), ctx, [
      { op: "profile_append", field: "tone", text: "no usar emojis." },
    ]);
    expect(out.rejected[0]!.reason).toContain("ya estaba aplicado");
    expect(updates).toHaveLength(0);
  });
});
