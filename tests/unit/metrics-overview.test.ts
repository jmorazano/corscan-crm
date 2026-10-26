import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";

/**
 * `getMetricsOverview` (024) con una BD stub que renderiza el SQL real:
 * toda consulta va scoped a la empresa y deja afuera el Laboratorio, el
 * Entrenador y el historial importado (salvo la serie, que cuenta el de
 * WhatsApp aparte como «pasado»); los números de Postgres (texto) se
 * convierten; la serie se rellena; y una zona que Postgres no conoce se
 * reintenta con la de Buenos Aires.
 */

type TotalsRow = Record<string, string>;

const DEFAULT_TOTALS: TotalsRow = {
  receivedWhatsapp: "7",
  receivedInstagram: "3",
  receivedPrevious: "5",
  receivedPreviousWhatsapp: "4",
  receivedPreviousInstagram: "1",
  convWhatsapp: "2",
  convInstagram: "1",
  convPreviousWhatsapp: "1",
  convPreviousInstagram: "1",
  agentWhatsapp: "5",
  agentInstagram: "1",
  agentPrevious: "4",
  agentConvWhatsapp: "2",
  agentConvInstagram: "1",
  agentConvPrevious: "2",
  allSent: "8",
};

const DEFAULT_SERIES = [
  { bucket: "2026-09-26", channel: "whatsapp", past: false, count: "4", conversations: "2" },
  { bucket: "2026-09-26", channel: "instagram", past: false, count: "2", conversations: "1" },
  { bucket: "2026-09-20", channel: "whatsapp", past: false, count: "3", conversations: "1" },
  { bucket: "2026-09-20", channel: "whatsapp", past: true, count: "25", conversations: "4" },
  { bucket: "2026-09-01", channel: "whatsapp", past: true, count: "30", conversations: "6" },
];

const state = vi.hoisted(() => ({
  queries: [] as { sql: string; params: unknown[] }[],
  totals: null as Record<string, string> | null,
  series: null as Record<string, unknown>[] | null,
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
          if (table !== schema.agentProfile) {
            // Totales: se registran las columnas (los count) junto al WHERE.
            const where = render(cond);
            const columns = Object.values(fields).map((f) => render(f).sql);
            state.queries.push({ sql: `${columns.join(",\n")}\nwhere ${where.sql}`, params: where.params });
            return Promise.resolve([state.totals]);
          }
          record(cond);
          const rows = [{ replyDelayMs: state.profileDelay }];
          return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
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
      return Promise.resolve(state.series);
    },
  };
  return { ...actual, getDb: () => db };
});

import { getMetricsOverview } from "@/server/metrics/overview";

const NOW = new Date("2026-09-26T18:30:00Z");

beforeEach(() => {
  state.queries = [];
  state.totals = DEFAULT_TOTALS;
  state.series = DEFAULT_SERIES;
  state.profileDelay = null;
  state.failTimeZone = null;
});

describe("getMetricsOverview", () => {
  it("convierte los números y rellena la serie", async () => {
    const o = await getMetricsOverview("org_a", "day", "America/Argentina/Buenos_Aires", NOW);
    // El pasado importado va aparte: no toca total ni comparación.
    expect(o.received).toEqual({
      total: 10,
      whatsapp: 7,
      instagram: 3,
      previous: 5,
      previousWhatsapp: 4,
      previousInstagram: 1,
      past: 55,
      // El pasado tampoco suma conversaciones.
      conversations: {
        total: 3,
        whatsapp: 2,
        instagram: 1,
        previous: 2,
        previousWhatsapp: 1,
        previousInstagram: 1,
      },
    });
    expect(o.agentSent).toEqual({
      total: 6,
      whatsapp: 5,
      instagram: 1,
      previous: 4,
      allSent: 8,
      conversations: { total: 3, whatsapp: 2, instagram: 1, previous: 2 },
    });
    expect(o.responseTime).toEqual({
      medianMs: 24000,
      avgMs: 31500.5,
      count: 12,
      previousMedianMs: 18000,
      replyDelayMs: 20_000,
    });
    expect(o.series).toHaveLength(30);
    expect(o.series[29]).toEqual({ key: "2026-09-26", whatsapp: 4, instagram: 2, past: 0, conversations: 3 });
    expect(o.series[23]).toEqual({ key: "2026-09-20", whatsapp: 3, instagram: 0, past: 25, conversations: 1 });
    expect(o.series[4]).toEqual({ key: "2026-09-01", whatsapp: 0, instagram: 0, past: 30, conversations: 0 });
    expect(o.series[0]).toEqual({ key: "2026-08-28", whatsapp: 0, instagram: 0, past: 0, conversations: 0 });
  });

  it("una conversación con muchos mensajes cuenta una vez", async () => {
    state.totals = {
      ...DEFAULT_TOTALS,
      receivedWhatsapp: "40",
      receivedInstagram: "0",
      convWhatsapp: "1",
      convInstagram: "0",
    };
    state.series = [{ bucket: "2026-09-26", channel: "whatsapp", past: false, count: "40", conversations: "1" }];
    const o = await getMetricsOverview("org_a", "day", "America/Argentina/Buenos_Aires", NOW);
    expect(o.received.total).toBe(40);
    expect(o.received.conversations.total).toBe(1);
    expect(o.series[29]?.conversations).toBe(1);
  });

  it("una conversación que cruza dos semanas cuenta en ambas barras y una sola vez en el total", async () => {
    // Postgres: count(distinct) por barra da 1 y 1; el de la tarjeta, 1.
    state.totals = {
      ...DEFAULT_TOTALS,
      receivedWhatsapp: "5",
      receivedInstagram: "0",
      convWhatsapp: "1",
      convInstagram: "0",
    };
    state.series = [
      { bucket: "2026-09-14", channel: "whatsapp", past: false, count: "3", conversations: "1" },
      { bucket: "2026-09-21", channel: "whatsapp", past: false, count: "2", conversations: "1" },
    ];
    const o = await getMetricsOverview("org_a", "week", "America/Argentina/Buenos_Aires", NOW);
    const byKey = Object.fromEntries(o.series.map((p) => [p.key, p.conversations]));
    expect(byKey["2026-09-14"]).toBe(1);
    expect(byKey["2026-09-21"]).toBe(1);
    // El total sale de la consulta del período, no de sumar las barras.
    expect(o.received.conversations.total).toBe(1);
    expect(o.series.reduce((sum, p) => sum + p.conversations, 0)).toBe(2);
  });

  it("las conversaciones se cuentan DISTINTAS y con el mismo filtro que sus mensajes", async () => {
    await getMetricsOverview("org_a", "day", "America/Argentina/Buenos_Aires", NOW);
    const totals = state.queries.find(
      (q) => q.sql.includes("count(distinct") && !q.sql.includes("date_trunc")
    )!;
    const recv = `("message"."direction" = 'in' and "message"."type" <> 'reaction')`;
    const agent = `(("message"."direction" = 'out' and "message"."status" <> 'failed') and "message"."ai_generated" = true)`;
    const current = `"message"."created_at" >= $`;
    for (const [what, ch] of [
      [recv, "whatsapp"],
      [recv, "instagram"],
      [agent, "whatsapp"],
      [agent, "instagram"],
    ] as const) {
      expect(totals.sql).toContain(
        `count(distinct "message"."conversation_id") filter (where ${what} and ${current}`
      );
      expect(totals.sql).toContain(`and "conversation"."kind" = '${ch}')`);
    }
    expect(totals.sql).toContain(`count(distinct "message"."conversation_id") filter (where ${agent} and not`);
    // Misma consulta que los mensajes: sin historial, sin sandbox.
    expect(totals.sql).toContain("\"message\".\"source\" <> 'history'");
    expect(totals.sql).toContain('"conversation"."is_test" = false');
    // La serie: distintas por (barra, canal, pasado).
    const series = state.queries.find((q) => q.sql.includes("date_trunc"))!;
    expect(series.sql).toContain('count(distinct "message"."conversation_id") as conversations');
    expect(series.sql).toContain("group by 1, 2, 3");
  });

  it("toda consulta va scoped a la empresa y deja afuera sandbox e historial (la serie: salvo el de WhatsApp)", async () => {
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
      if (q.sql.includes("date_trunc")) {
        // La serie: el historial de WhatsApp entra marcado como pasado;
        // el de Instagram (parcial) sigue afuera.
        expect(q.sql).toContain(
          "(\"message\".\"source\" <> 'history' or \"conversation\".\"kind\" = 'whatsapp')"
        );
        expect(q.sql).toContain("(\"message\".\"source\" = 'history') as past");
      } else {
        expect(q.sql).toContain("\"message\".\"source\" <> 'history'");
        expect(q.sql).not.toContain("\"message\".\"source\" = 'history'");
      }
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
