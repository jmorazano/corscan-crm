import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";

/**
 * FR-034 + Constitución IV (estados monotónicos), hole de US2: Promise.race
 * NO cancela runAllCases. Sin bandera de cancelación ni guard de estado, al
 * vencer el timeout la corrida seguía viva ("zombi"): publicaba lab.run
 * 'running' DESPUÉS del 'failed' (resucitando la barra de progreso) y el
 * update final incondicional volteaba failed→done. Este test simula el
 * timeout con un juez que nunca responde y verifica que el zombi muere.
 */

const state = vi.hoisted(() => ({
  run: { status: "running" as string },
  runUpdates: [] as { set: Record<string, unknown>; params: unknown[] }[],
  published: [] as { organizationId: string; status: string }[],
}));

vi.mock("@/server/lab/personas", () => ({
  PERSONAS: [
    {
      key: "curioso",
      label: "Curioso",
      phone: "5215550009",
      contactName: "Curioso de prueba",
      script: ["hola, ¿qué venden?"],
    },
  ],
}));

const judgeCaseMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/lab/judge", () => ({
  judgeCase: (...args: unknown[]) => judgeCaseMock(...args),
  computeScore: () => 100,
}));

vi.mock("@/server/ai/pipeline", () => ({
  runAgentTurn: () => Promise.resolve(),
}));

vi.mock("@/server/events/bus", () => ({
  publish: (
    organizationId: string,
    event: { data: { status: string } }
  ) => {
    state.published.push({ organizationId, status: event.data.status });
  },
  subscribe: () => () => {},
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const schema = actual.schema;
  const render = (cond: unknown) => new PgDialect().sqlToQuery(cond as SQL);

  const caseRows = [
    {
      id: "case_1",
      persona: "curioso",
      runId: "run_1",
      status: "pending",
      createdAt: new Date(),
    },
  ];

  const thenable = (rows: unknown[]) => ({
    then: (resolve: (v: unknown) => void) => resolve(rows),
  });

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === schema.agentTestCase) {
            return {
              orderBy: () => Promise.resolve(caseRows),
              ...thenable(caseRows),
            };
          }
          if (table === schema.conversation) {
            // handoff inmediato: el guion corta tras la primera línea
            return { limit: () => Promise.resolve([{ handoffAt: new Date() }]) };
          }
          if (table === schema.message) {
            return { orderBy: () => Promise.resolve([]) };
          }
          if (table === schema.agentProfile) {
            return { limit: () => Promise.resolve([]) };
          }
          return { limit: () => Promise.resolve([]), ...thenable([]) };
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        ...thenable([]),
        returning: () =>
          Promise.resolve([
            table === actual.schema.agentTestRun ? { id: "run_1" } : values,
          ]),
        onConflictDoNothing: () => ({
          ...thenable([]),
          returning: () => Promise.resolve([values]),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const isRun = table === schema.agentTestRun;
          const params = isRun ? render(cond).params : [];
          if (isRun) state.runUpdates.push({ set, params });
          return {
            ...thenable([]),
            returning: () => {
              if (!isRun) return Promise.resolve([]);
              // simula el guard WHERE status='running' del índice de estados
              const guarded = params.includes("running");
              if (guarded && state.run.status !== "running") {
                return Promise.resolve([]);
              }
              state.run.status = String(set.status);
              return Promise.resolve([{ id: "run_1" }]);
            },
          };
        },
      }),
    }),
  };
  return { ...actual, getDb: () => db };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

beforeEach(() => {
  state.run.status = "running";
  state.runUpdates.length = 0;
  state.published.length = 0;
  judgeCaseMock.mockReset();
});

/** Drena la cadena de awaits de los stubs (todos resuelven en microtasks). */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}

describe("runner del Laboratorio: timeout sin corrida zombi (US2/FR-034)", () => {
  it("timeout → failed; el loop pendiente NO publica más ni voltea failed→done", async () => {
    vi.useFakeTimers();
    try {
      // juez que nunca responde: el caso queda colgado hasta después del timeout
      let resolveJudge!: (v: unknown) => void;
      judgeCaseMock.mockImplementation(
        () => new Promise((resolve) => (resolveJudge = resolve))
      );

      const { startRun } = await import("@/server/lab/runner");
      await startRun("org_lab");
      await flushMicrotasks(); // llega hasta judgeCase y se cuelga
      expect(judgeCaseMock).toHaveBeenCalledTimes(1);
      expect(state.published.map((p) => p.status)).toEqual(["running"]);

      // vencen los 10 minutos → la corrida muere como 'failed'
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      await flushMicrotasks();
      expect(state.run.status).toBe("failed");
      const publishedAfterFail = state.published.map((p) => p.status);
      expect(publishedAfterFail).toEqual(["running", "failed"]);

      // el juez zombi responde tarde: el loop debe cortar SIN efectos nuevos
      resolveJudge({
        status: "done",
        verdict: { veredicto: "ok", hallazgos: "" },
      });
      await flushMicrotasks();

      expect(state.run.status).toBe("failed"); // jamás failed→done (Const. IV)
      expect(state.published.map((p) => p.status)).toEqual(publishedAfterFail);
    } finally {
      vi.useRealTimers();
    }
  });

  it("corrida feliz → done, con guard de estado en el update final", async () => {
    judgeCaseMock.mockResolvedValue({
      status: "done",
      verdict: { veredicto: "ok", hallazgos: "" },
    });
    const { startRun } = await import("@/server/lab/runner");
    await startRun("org_lab");
    await vi.waitFor(() => expect(state.run.status).toBe("done"));

    const statuses = state.published.map((p) => p.status);
    expect(statuses[statuses.length - 1]).toBe("done");
    // el update final SOLO aplica sobre una corrida aún 'running'
    const doneUpdate = state.runUpdates.find((u) => u.set.status === "done");
    expect(doneUpdate?.params).toContain("running");
  });
});
