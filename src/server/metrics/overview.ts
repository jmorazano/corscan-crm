import { sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  DEFAULT_METRICS_TIMEZONE,
  fillSeries,
  metricsWindow,
  type MetricsOverview,
  type MetricsRange,
} from "@/lib/metrics";
import { getEnv } from "@/lib/env";
import { resolveReplyDelayMs } from "@/lib/agent-timing";

/**
 * Métricas del propietario (024). Tres consultas por pedido, todas con
 * `scoped()` sobre `message.organization_id` y la conversación de la MISMA
 * empresa. Qué cuenta (spec 024, «Decisiones»):
 *
 * - Solo conversaciones REALES de WhatsApp o Instagram: el Laboratorio y el
 *   Entrenador son `is_test` y el Entrenador además es `kind='trainer'`.
 * - Nunca el historial importado (`source='history'`, 017/023): es una
 *   copia parcial del pasado que inflaría la barra del día de la importación
 *   o de fechas viejas según el caso.
 * - Recibidos sin las reacciones con emoji de Instagram (`type='reaction'`).
 * - Salientes sin los fallidos: el cliente no los recibió.
 *
 * Los `timestamp` de la BD son UTC sin zona (convención del repo); las
 * fechas viajan como texto ISO con cast, nunca como `Date` crudo dentro de
 * `sql` (postgres-js revienta, ver 023).
 */

const m = schema.message;
const c = schema.conversation;

function ts(d: Date): SQL {
  return sql`${d.toISOString()}::timestamp`;
}

/** Filtro común: mensajes de conversaciones reales de la empresa. */
function realMessages(organizationId: string, from: Date, to: Date): SQL {
  return scoped(
    m.organizationId,
    organizationId,
    sql`${c.organizationId} = ${m.organizationId}`,
    sql`${c.isTest} = false`,
    sql`${c.kind} in ('whatsapp', 'instagram')`,
    sql`${m.source} <> 'history'`,
    sql`${m.createdAt} >= ${ts(from)}`,
    sql`${m.createdAt} < ${ts(to)}`
  );
}

const IS_RECEIVED = sql`(${m.direction} = 'in' and ${m.type} <> 'reaction')`;
const IS_SENT = sql`(${m.direction} = 'out' and ${m.status} <> 'failed')`;
const IS_AGENT = sql`(${IS_SENT} and ${m.aiGenerated} = true)`;

/**
 * Cuánto le lleva al cliente desde que la conversación queda esperando
 * respuesta hasta que llega la del agente.
 *
 * Numeración por conversación: `out_seq` = cuántos salientes hubo hasta ese
 * mensaje (inclusive). Los entrantes con el mismo `out_seq` k forman el
 * grupo que espera respuesta, y la respuesta es el saliente número k+1. Si
 * ese saliente es del agente, se mide desde el PRIMER entrante del grupo;
 * si lo mandó una persona o una campaña, no entra. Los fallidos no
 * responden nada: se excluyen de la numeración.
 *
 * Solo se lee una semana antes del período de comparación (acota el
 * escaneo); un cliente que esperó más que eso cuenta desde ese borde.
 */
async function responseTimes(
  organizationId: string,
  previousStart: Date,
  start: Date,
  end: Date
): Promise<{
  medianMs: number | null;
  avgMs: number | null;
  count: number;
  previousMedianMs: number | null;
}> {
  const scanFrom = new Date(previousStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rows = await getDb().execute(sql`
    with msgs as (
      select
        ${m.conversationId} as conversation_id,
        ${m.direction} as direction,
        ${m.aiGenerated} as ai_generated,
        ${m.createdAt} as created_at,
        count(*) filter (where ${m.direction} = 'out') over (
          partition by ${m.conversationId}
          order by ${m.createdAt}, ${m.id}
          rows between unbounded preceding and current row
        ) as out_seq
      from ${m}
      inner join ${c} on ${c.id} = ${m.conversationId}
      where ${realMessages(organizationId, scanFrom, end)}
        and (${IS_RECEIVED} or ${IS_SENT})
    ),
    waiting as (
      select conversation_id, out_seq, min(created_at) as first_in
      from msgs
      where direction = 'in'
      group by conversation_id, out_seq
    ),
    replies as (
      select
        extract(epoch from (r.created_at - w.first_in)) * 1000 as ms,
        r.created_at >= ${ts(start)} as is_current
      from msgs r
      inner join waiting w
        on w.conversation_id = r.conversation_id and r.out_seq = w.out_seq + 1
      where r.direction = 'out'
        and r.ai_generated = true
        and r.created_at >= ${ts(previousStart)}
    )
    select
      avg(ms) filter (where is_current) as avg_ms,
      percentile_cont(0.5) within group (order by ms) filter (where is_current) as median_ms,
      count(*) filter (where is_current) as n,
      percentile_cont(0.5) within group (order by ms) filter (where not is_current) as previous_median_ms
    from replies
  `);
  const row = (rows as unknown as Record<string, unknown>[])[0] ?? {};
  return {
    medianMs: toNumberOrNull(row.median_ms),
    avgMs: toNumberOrNull(row.avg_ms),
    count: Number(row.n ?? 0),
    previousMedianMs: toNumberOrNull(row.previous_median_ms),
  };
}

/**
 * Espera configurada antes de responder (022). Misma regla que
 * `replyDelayFor` de `server/ai/trigger.ts`, sin importar ese módulo: arrastra
 * el pipeline entero del agente a una ruta que solo lee.
 */
async function replyDelayMsFor(organizationId: string): Promise<number> {
  const fallback = getEnv().AGENT_COALESCE_MS;
  const rows = await getDb()
    .select({ replyDelayMs: schema.agentProfile.replyDelayMs })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return resolveReplyDelayMs(rows[0]?.replyDelayMs, fallback);
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function overviewIn(
  organizationId: string,
  range: MetricsRange,
  timeZone: string,
  now: Date
): Promise<MetricsOverview> {
  const w = metricsWindow(range, timeZone, now);
  const db = getDb();
  const isCurrent = sql`${m.createdAt} >= ${ts(w.start)}`;

  const [totals, seriesRows, rt, replyDelayMs] = await Promise.all([
    db
      .select({
        receivedWhatsapp: sql<string>`count(*) filter (where ${IS_RECEIVED} and ${isCurrent} and ${c.kind} = 'whatsapp')`,
        receivedInstagram: sql<string>`count(*) filter (where ${IS_RECEIVED} and ${isCurrent} and ${c.kind} = 'instagram')`,
        receivedPrevious: sql<string>`count(*) filter (where ${IS_RECEIVED} and not ${isCurrent})`,
        agent: sql<string>`count(*) filter (where ${IS_AGENT} and ${isCurrent})`,
        agentPrevious: sql<string>`count(*) filter (where ${IS_AGENT} and not ${isCurrent})`,
        allSent: sql<string>`count(*) filter (where ${IS_SENT} and ${isCurrent})`,
      })
      .from(m)
      .innerJoin(c, sql`${c.id} = ${m.conversationId}`)
      .where(realMessages(organizationId, w.previousStart, w.end)),
    db.execute(sql`
      select
        to_char(date_trunc(${w.unit}, (${m.createdAt} at time zone 'UTC') at time zone ${timeZone}), 'YYYY-MM-DD') as bucket,
        ${c.kind} as channel,
        count(*) as count
      from ${m}
      inner join ${c} on ${c.id} = ${m.conversationId}
      where ${realMessages(organizationId, w.start, w.end)} and ${IS_RECEIVED}
      group by 1, 2
    `),
    responseTimes(organizationId, w.previousStart, w.start, w.end),
    replyDelayMsFor(organizationId),
  ]);

  const t = totals[0];
  const whatsapp = Number(t?.receivedWhatsapp ?? 0);
  const instagram = Number(t?.receivedInstagram ?? 0);
  const series = fillSeries(
    w.keys,
    (seriesRows as unknown as Record<string, unknown>[]).map((r) => ({
      bucket: String(r.bucket),
      channel: String(r.channel),
      count: Number(r.count),
    }))
  );

  return {
    range,
    timeZone,
    unit: w.unit,
    received: {
      total: whatsapp + instagram,
      whatsapp,
      instagram,
      previous: Number(t?.receivedPrevious ?? 0),
    },
    agentSent: {
      total: Number(t?.agent ?? 0),
      previous: Number(t?.agentPrevious ?? 0),
      allSent: Number(t?.allSent ?? 0),
    },
    responseTime: { ...rt, replyDelayMs },
    series,
  };
}

/**
 * Métricas de la empresa en el rango pedido. La zona ya viene validada con
 * `Intl`; si igual Postgres no la conoce (tablas de zonas distintas), se
 * repite con la de Buenos Aires en vez de romper la página.
 */
export async function getMetricsOverview(
  organizationId: string,
  range: MetricsRange,
  timeZone: string,
  now: Date = new Date()
): Promise<MetricsOverview> {
  try {
    return await overviewIn(organizationId, range, timeZone, now);
  } catch (err) {
    if (timeZone !== DEFAULT_METRICS_TIMEZONE && /time zone/i.test(String(err))) {
      return overviewIn(organizationId, range, DEFAULT_METRICS_TIMEZONE, now);
    }
    throw err;
  }
}
