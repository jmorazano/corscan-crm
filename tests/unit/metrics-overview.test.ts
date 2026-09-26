import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";

/**
 * `getMetricsOverview` (024) con una BD stub que renderiza el SQL real:
 * toda consulta va scoped a la empresa y deja afuera el Laboratorio, el
 * Entrenador y el historial importado; los números de Postgres (texto) se
 * convierten; la serie se rellena; y una zona que Postgres no conoce se
 * reintenta con la de Buenos Aires.
 */

const state = vi.hoisted(() => ({
  queries: [] as { sql: string; params: unknown[] }[],
  profileDelay: null as number | null,
  failTimeZone: null as string | null,
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ AGENT_COALESCE_MS: 20_000 }),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const schema = actual.schema;
  const render = (q: unknown) => new PgDialect().sqlToQuery(q as SQL);

  function record(q: unknown) {
    const r = render(q);
    state.queries.push({ sql: r.sql, params: r.params });
    return r;
  }

  const db = {
    select: (fields: Record<string, unknown>) => ({
      from: (table: unknown) => {
        const finish = (cond: unknown) => {
          const r = record(cond);
          if (table === schema.agentProfile) {
            const rows = [{ replyDelayMs: state.profileDelay }];
            return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
          }
          // Totales: Postgres devuelve los count(*) como texto.
          void fields;
          void r;
          return Promise.resolve([
            {
              receivedWhatsapp: "7",
              receivedInstagram: "3",
              receivedPrevious: "5",
              agent: "6",
              agentPrevious: "4",
              allSent: "8",
            },
          ]);
        };
        return {
          innerJoin: () => ({ where: finish }),
          where: finish,
        };
      },
    }),
    execute: (q: unknown) => {
      const r = record(q);
      if (state.failTimeZone && r.params.includes(state.failTimeZone)) {
        return Promise.reject(new Error(`time zone "${state.failTimeZone}" not recognized`));
      }
      if (r.sql.includes("percentile_cont")) {
        return Promise.resolve([
          { avg_ms: "31500.5", median_ms: 24000, n: "12", previous_median_ms: "18000" },
        ]);
      }
      return Promise.resolve([
        { bucket: "2026-09-26", channel: "whatsapp", count: "4" },
        { bucket: "2026-09-26", channel: "instagram", count: "2" },
        { bucket: "2026-09-20", channel: "whatsapp", count: "3" },
      ]);
    },
  };
  return { ...actual, getDb: () => db };
});

import { getMetricsOverview } from "@/server/metrics/overview";

const NOW = new Date("2026-09-26T18:30:00Z");

beforeEach(() => {
  state.queries = [];
  state.profileDelay = null;
  state.failTimeZone = null;
});

describe("getMetricsOverview", () => {
  it("convierte los números y rellena la serie", async () => {
    const o = await getMetricsOverview("org_a", "day", "America/Argentina/Buenos_Aires", NOW);
    expect(o.received).toEqual({ total: 10, whatsapp: 7, instagram: 3, previous: 5 });
    expect(o.agentSent).toEqual({ total: 6, previous: 4, allSent: 8 });
    expect(o.responseTime).toEqual({
      medianMs: 24000,
      avgMs: 31500.5,
      count: 12,
      previousMedianMs: 18000,
      replyDelayMs: 20_000,
    });
    expect(o.series).toHaveLength(30);
    expect(o.series[29]).toEqual({ key: "2026-09-26", whatsapp: 4, instagram: 2 });
    expect(o.series[23]).toEqual({ key: "2026-09-20", whatsapp: 3, instagram: 0 });
    expect(o.series[0]).toEqual({ key: "2026-08-28", whatsapp: 0, instagram: 0 });
  });

  it("toda consulta va scoped a la empresa y deja afuera sandbox e historial", async () => {
    await getMetricsOverview("org_a", "week", "America/Argentina/Buenos_Aires", NOW);
    const messageQueries = state.queries.filter((q) => q.sql.includes('"message"'));
    expect(messageQueries).toHaveLength(3); // totales, serie, tiempos de respuesta
    for (const q of messageQueries) {
      const m = /"message"\."organization_id" = \$(\d+)/.exec(q.sql);
      expect(m, q.sql).not.toBeNull();
      expect(q.params[Number(m![1]) - 1]).toBe("org_a");
      expect(q.sql).toContain('"conversation"."organization_id" = "message"."organization_id"');
      expect(q.sql).toContain('"conversation"."is_test" = false');
      expect(q.sql).toContain("\"conversation\".\"kind\" in ('whatsapp', 'instagram')");
      expect(q.sql).toContain("\"message\".\"source\" <> 'history'");
    }
    const profile = state.queries.find((q) => q.sql.includes('"agent_profile"'));
    expect(profile?.params).toEqual(["org_a"]);
  });

  it("la serie agrupa en hora local con la unidad del rango", async () => {
    await getMetricsOverview("org_a", "year", "Europe/Madrid", NOW);
    const series = state.queries.find((q) => q.sql.includes("date_trunc"));
    expect(series?.params).toContain("month");
    expect(series?.params).toContain("Europe/Madrid");
    // Recibidos sin reacciones de Instagram.
    expect(series?.sql).toContain("\"message\".\"type\" <> 'reaction'");
  });

  it("el tiempo de respuesta solo mide respuestas del agente y excluye fallidos", async () => {
    await getMetricsOverview("org_a", "day", "America/Argentina/Buenos_Aires", NOW);
    const rt = state.queries.find((q) => q.sql.includes("percentile_cont"));
    expect(rt?.sql).toContain("r.ai_generated = true");
    expect(rt?.sql).toContain("r.out_seq = w.out_seq + 1");
    expect(rt?.sql).toContain("\"message\".\"status\" <> 'failed'");
    // La comparación es mediana contra mediana (el titular de la tarjeta).
    expect(rt?.sql).toContain(
      "percentile_cont(0.5) within group (order by ms) filter (where not is_current) as previous_median_ms"
    );
  });

  it("la espera configurada de la empresa pisa la de instancia", async () => {
    state.profileDelay = 5_000;
    const o = await getMetricsOverview("org_a", "day", "America/Argentina/Buenos_Aires", NOW);
    expect(o.responseTime.replyDelayMs).toBe(5_000);
  });

  it("zona desconocida para Postgres → reintenta con Buenos Aires", async () => {
    state.failTimeZone = "Etc/Rara";
    const o = await getMetricsOverview("org_a", "day", "Etc/Rara", NOW);
    expect(o.timeZone).toBe("America/Argentina/Buenos_Aires");
    expect(o.series).toHaveLength(30);
  });
});
