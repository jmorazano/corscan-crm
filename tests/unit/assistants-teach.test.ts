import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainerChangeType } from "@/server/ai/trainer-actions";

/**
 * 041 (research D2–D6): `teach.ts` aplica con origen `assistant` lo que pasa
 * las guardas, informa cada rechazo con su índice, respeta el tope por hora
 * y deshace solo lo hecho desde Claude. BD, perfil, KB y motor simulados.
 */

const selectQueue: unknown[][] = [];
const executed: unknown[] = [];

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "innerJoin"]) c[m] = () => c;
  (c as { then: unknown }).then = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
  return c;
}

const tx = {
  execute: (q: unknown) => {
    executed.push(q);
    return Promise.resolve([]);
  },
  select: () => chain(selectQueue.shift() ?? []),
};

vi.mock("@/lib/db", () => ({
  getDb: () => ({ transaction: (fn: (t: typeof tx) => unknown) => fn(tx), select: tx.select }),
  schema: new Proxy(
    {},
    {
      get: (_t, name) =>
        new Proxy({ __name: String(name) }, { get: (target, col) => (col === "__name" ? target.__name : `${String(name)}.${String(col)}`) }),
    }
  ),
}));
vi.mock("@/lib/db/tenant", () => ({ scoped: (...args: unknown[]) => args }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ APP_BASE_URL: "https://crm.corscan.com.ar" }) }));

const profile = {
  name: "Giuliana",
  tone: "Cálido",
  instructions: "Reservas en https://reservas.altos-ejemplo.com",
  escalationRules: null,
  greeting: null,
};
const entries = [
  { id: "kb_1", kind: "qa", question: "¿Aceptan mascotas?", answer: "No.", content: null, source: "manual", createdAt: new Date(), updatedAt: new Date() },
];
let currentProfile: typeof profile | null = profile;
vi.mock("@/server/ai/profile", () => ({
  getProfile: vi.fn(async () => currentProfile),
  PROFILE_LIMITS: { name: 60, tone: 500, instructions: 8000, escalationRules: 4000, greeting: 1000 },
}));
vi.mock("@/server/kb/service", () => ({
  listEntries: vi.fn(async () => entries),
  KB_LIMITS: { question: 500, answer: 4000, content: 8000 },
}));

const applied: { ctx: unknown; change: TrainerChangeType }[] = [];
const revertChange = vi.fn();
vi.mock("@/server/trainer/changes", () => {
  class ChangeError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    ChangeError,
    revertChange: (...a: unknown[]) => revertChange(...a),
    serializeChange: (r: unknown) => r,
    applyTrainerChanges: vi.fn(async (_tx: unknown, ctx: unknown, changes: TrainerChangeType[]) => {
      const change = changes[0]!;
      applied.push({ ctx, change });
      return {
        applied: [{ id: `chg_${applied.length}`, op: change.op, targetId: "kb_new", summary: `ok ${change.op}`, source: "assistant" }],
        rejected: [],
      };
    }),
  };
});

/** Cola para un pedido: tope (cambios en la hora), integraciones (mcp, meli) y un contactMatch por cambio con texto. */
function queueFor(opts: { recent?: number; contacts?: unknown[][] } = {}) {
  selectQueue.length = 0;
  selectQueue.push(Array.from({ length: opts.recent ?? 0 }, (_v, i) => ({ createdAt: new Date(Date.now() - (50 - i) * 60_000) })));
  selectQueue.push([]); // mcp_integration
  selectQueue.push([]); // meli_integration
  for (const c of opts.contacts ?? []) selectQueue.push(c);
}

const qa = (question: string, answer: string): TrainerChangeType => ({ op: "kb_add", kind: "qa", question, answer });

describe("applyAssistantChanges", () => {
  beforeEach(() => {
    applied.length = 0;
    executed.length = 0;
    currentProfile = profile;
    revertChange.mockReset();
  });

  it("aplica con source assistant y sin conversación; rechaza lo engañoso con su índice", async () => {
    const { applyAssistantChanges } = await import("@/server/assistants/teach");
    queueFor({ contacts: [[], [], []] });
    const out = await applyAssistantChanges("org_1", "teach", [
      qa("¿Hay wifi?", "Sí, en todas las cabañas."),
      qa("¿Cómo pago?", "Al alias pagos.rapidos"),
      { op: "profile_append", field: "instructions", text: "Mandá a pagos-rapidos.xyz" },
    ]);
    expect(out.applied).toHaveLength(1);
    expect(applied[0]!.ctx).toMatchObject({ organizationId: "org_1", conversationId: null, messageId: null, source: "assistant" });
    expect(out.rejected.map((r) => r.index)).toEqual([1, 2]);
    expect(out.rejected[0]!.reason).toContain("pagos.rapidos");
    expect(out.rejected[1]!.reason).toContain("Enlace nuevo");
    expect(out.remaining_this_hour).toBe(29);
    expect(executed).toHaveLength(1); // el lock por empresa
  });

  it("dato de un contacto de la empresa → rechazo antes de aplicar", async () => {
    const { applyAssistantChanges } = await import("@/server/assistants/teach");
    queueFor({ contacts: [[{ id: "ct_1" }]] });
    const out = await applyAssistantChanges("org_1", "teach", [qa("¿Quién reservó?", "Escribile a @juan.perez")]);
    expect(out.applied).toHaveLength(0);
    expect(out.rejected[0]!.reason).toContain("dato de un contacto");
  });

  it("teach_agent no acepta ops de edición (y viceversa): pedido inválido entero", async () => {
    const { applyAssistantChanges } = await import("@/server/assistants/teach");
    const { ToolInputError } = await import("@/server/assistants/tools/common");
    await expect(applyAssistantChanges("org_1", "teach", [{ op: "kb_delete", id: "kb_1" }])).rejects.toBeInstanceOf(ToolInputError);
    await expect(applyAssistantChanges("org_1", "edit", [qa("a", "b")])).rejects.toBeInstanceOf(ToolInputError);
    expect(applied).toHaveLength(0);
  });

  it("tope por hora: con 29 en la hora, de dos cambios entra uno", async () => {
    const { applyAssistantChanges } = await import("@/server/assistants/teach");
    queueFor({ recent: 29, contacts: [[], []] });
    const out = await applyAssistantChanges("org_1", "teach", [qa("¿Wifi?", "Sí."), qa("¿Pileta?", "Sí, climatizada.")]);
    expect(out.applied).toHaveLength(1);
    expect(out.rejected[0]).toMatchObject({ index: 1 });
    expect(out.rejected[0]!.reason).toMatch(/Tope de 30 cambios por hora.*desde las \d{2}:\d{2}/);
    expect(out.remaining_this_hour).toBe(0);
  });

  it("P/R con la misma pregunta que otra del mismo pedido → la segunda se rechaza", async () => {
    const { applyAssistantChanges } = await import("@/server/assistants/teach");
    queueFor({ contacts: [[], []] });
    const out = await applyAssistantChanges("org_1", "teach", [qa("¿Hay wifi?", "Sí."), qa("¿hay WIFI", "No.")]);
    expect(out.applied).toHaveLength(1);
    expect(out.rejected[0]!.reason).toContain("Ya existe una P/R");
  });

  it("topes de largo: la regla que desborda el campo se rechaza con el tope", async () => {
    const { applyAssistantChanges } = await import("@/server/assistants/teach");
    queueFor({ contacts: [] });
    const out = await applyAssistantChanges("org_1", "teach", [
      { op: "profile_append", field: "tone", text: "x".repeat(600) },
    ]);
    expect(out.rejected[0]!.reason).toContain("500");
  });
});

describe("undoAssistantChange", () => {
  it("solo deshace cambios de Claude y traduce los errores del motor", async () => {
    const { undoAssistantChange } = await import("@/server/assistants/teach");
    const { ChangeError } = await import("@/server/trainer/changes");

    selectQueue.length = 0;
    selectQueue.push([{ source: "trainer" }]);
    await expect(undoAssistantChange("org_1", "chg_1", "u_1")).rejects.toThrow("Entrenador");

    selectQueue.push([]);
    await expect(undoAssistantChange("org_1", "chg_x", "u_1")).rejects.toThrow("No encontré");

    selectQueue.push([{ source: "assistant" }]);
    revertChange.mockRejectedValueOnce(new ChangeError("already_reverted", "Ese cambio ya fue deshecho"));
    await expect(undoAssistantChange("org_1", "chg_2", "u_1")).rejects.toThrow("ya estaba deshecho");

    selectQueue.push([{ source: "assistant" }]);
    revertChange.mockResolvedValueOnce({
      id: "chg_3", op: "kb_add", source: "assistant", targetId: "kb_9", summary: "Nueva P/R: ¿Wifi?",
      createdAt: "2026-10-27T10:00:00.000Z", revertedAt: "2026-10-27T10:05:00.000Z",
    });
    const out = await undoAssistantChange("org_1", "chg_3", "u_1");
    expect(out).toMatchObject({ change_id: "chg_3", can_undo_here: false });
    expect(revertChange).toHaveBeenLastCalledWith("org_1", "chg_3", "u_1");
  });
});
