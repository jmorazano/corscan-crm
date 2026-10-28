import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { isStaleDays, staleCutoff, type StaleDays } from "@/lib/lead-stages";
import { recordConversationEvent } from "@/server/ai/events";

/**
 * 044: «pasar a perdido tras N días sin que el cliente escriba», por empresa
 * y APAGADO por defecto (cada negocio tiene sus tiempos: en producción,
 * después de 14 días callado volvía el 1,4 % en un alojamiento y el 22 % en
 * una inmobiliaria). Solo etapas abiertas; nunca toca a un cliente. El reloj
 * arranca en lo último entre el último mensaje del cliente y el último
 * movimiento del lead (si una persona lo movió ayer, no se pierde hoy).
 */

const TICK_MS = 15 * 60_000;
/** Tope de leads por empresa y barrido (el resto, en el próximo). */
const SWEEP_BATCH = 500;

const globalForStale = globalThis as unknown as {
  __voceroStaleTicker?: ReturnType<typeof setInterval>;
  __voceroStaleRunning?: boolean;
};

export async function getStaleDays(organizationId: string): Promise<StaleDays | null> {
  const rows = await getDb()
    .select({ days: schema.pipelineSettings.staleLostDays })
    .from(schema.pipelineSettings)
    .where(scoped(schema.pipelineSettings.organizationId, organizationId))
    .limit(1);
  const days = rows[0]?.days ?? null;
  return isStaleDays(days) ? days : null;
}

export async function setStaleDays(organizationId: string, days: StaleDays | null): Promise<void> {
  await getDb()
    .insert(schema.pipelineSettings)
    .values({ id: newId("pipelineSettings"), organizationId, staleLostDays: days })
    .onConflictDoUpdate({
      target: schema.pipelineSettings.organizationId,
      set: { staleLostDays: days, updatedAt: new Date() },
    });
}

type Candidate = { leadId: string; stageId: string; conversationId: string | null };

function candidatesQuery(organizationId: string, days: number, now: Date, limit: number | null) {
  const cutoff = staleCutoff(now, days).toISOString();
  return sql`
    select l.id as lead_id, l.stage_id,
      (select cv.id from conversation cv
        where cv.contact_id = l.contact_id and cv.organization_id = ${organizationId} and not cv.is_test
        order by cv.last_message_at desc nulls last limit 1) as conversation_id
    from lead l
    join pipeline_stage s on s.id = l.stage_id
    join contact c on c.id = l.contact_id
    where l.organization_id = ${organizationId}
      and s.kind = 'open'
      and not c.is_test
      and greatest(
        coalesce((select max(cv.last_inbound_at) from conversation cv
                  where cv.contact_id = l.contact_id and cv.organization_id = ${organizationId}
                    and not cv.is_test), l.created_at),
        l.updated_at
      ) < ${cutoff}::timestamp
    ${limit ? sql`limit ${limit}` : sql``}`;
}

/** Vista previa: cuántos leads pasarían hoy con esa cantidad de días. */
export async function countStaleLeads(organizationId: string, days: number, now = new Date()): Promise<number> {
  const rows = await getDb().execute(sql`select count(*)::int as n from (${candidatesQuery(organizationId, days, now, null)}) q`);
  const row = (rows as unknown as { n: number }[])[0];
  return row?.n ?? 0;
}

async function lostStageOf(organizationId: string): Promise<{ id: string; name: string } | null> {
  const rows = await getDb()
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId, eq(schema.pipelineStage.kind, "lost")))
    .limit(1);
  return rows[0] ?? null;
}

/** Barre UNA empresa. Devuelve cuántos leads pasaron a perdido. */
export async function sweepStaleLeads(organizationId: string, days: number, now = new Date()): Promise<number> {
  const lost = await lostStageOf(organizationId);
  if (!lost) return 0;
  const db = getDb();
  const rows = (await db.execute(
    candidatesQuery(organizationId, days, now, SWEEP_BATCH)
  )) as unknown as { lead_id: string; stage_id: string; conversation_id: string | null }[];
  const candidates: Candidate[] = rows.map((r) => ({
    leadId: r.lead_id,
    stageId: r.stage_id,
    conversationId: r.conversation_id,
  }));
  let moved = 0;
  for (const c of candidates) {
    // Compare-and-set: si alguien lo movió mientras tanto, queda como lo dejó.
    const updated = await db
      .update(schema.lead)
      .set({ stageId: lost.id, staleLostAt: now, updatedAt: now })
      .where(
        and(
          scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, c.leadId)),
          eq(schema.lead.stageId, c.stageId)
        )
      )
      .returning({ id: schema.lead.id });
    if (updated.length === 0) continue;
    moved++;
    if (c.conversationId) {
      await recordConversationEvent({
        organizationId,
        conversationId: c.conversationId,
        kind: "lead_stale",
        details: { days, stage: lost.name },
      });
    }
  }
  return moved;
}

/** Un barrido de todas las empresas que encendieron la regla. */
export async function runStaleSweep(now = new Date()): Promise<{ organizations: number; moved: number }> {
  const result = { organizations: 0, moved: 0 };
  if (globalForStale.__voceroStaleRunning) return result;
  globalForStale.__voceroStaleRunning = true;
  try {
    const settings = await getDb()
      .select({ organizationId: schema.pipelineSettings.organizationId, days: schema.pipelineSettings.staleLostDays })
      .from(schema.pipelineSettings)
      .where(sql`${schema.pipelineSettings.staleLostDays} is not null`);
    for (const s of settings) {
      if (!isStaleDays(s.days)) continue;
      result.organizations++;
      try {
        result.moved += await sweepStaleLeads(s.organizationId, s.days, now);
      } catch (err) {
        console.error(
          `[pipeline] falló el barrido de días sin respuesta de ${s.organizationId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    return result;
  } finally {
    globalForStale.__voceroStaleRunning = false;
  }
}

export function startStaleTicker(): void {
  if (globalForStale.__voceroStaleTicker) return;
  const run = () => {
    void runStaleSweep().catch((err) =>
      console.warn("[pipeline] el barrido de días sin respuesta falló:", err instanceof Error ? err.message : err)
    );
  };
  globalForStale.__voceroStaleTicker = setInterval(run, TICK_MS);
  globalForStale.__voceroStaleTicker.unref?.();
}
