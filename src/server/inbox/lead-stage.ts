import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { canAutoMove, stageRoles, type StageLike, type StageRole } from "@/lib/lead-stages";

/**
 * 044: movimientos AUTOMÁTICOS del lead (agente y reglas del sistema). Todos
 * pasan por `canAutoMove` (solo hacia adelante, salvo perdido) y escriben con
 * compare-and-set sobre la etapa leída: si una persona del equipo lo arrastró
 * en el mismo instante, gana la persona. Nunca lanza: ordenar el pipeline
 * jamás tumba un turno ni una ingesta.
 */

export type LeadStageState = {
  stages: StageLike[];
  leadId: string | null;
  current: StageLike | null;
  optedOut: boolean;
};

export async function loadLeadStageState(
  organizationId: string,
  contactId: string
): Promise<LeadStageState> {
  const db = getDb();
  const stages = await db
    .select({
      id: schema.pipelineStage.id,
      name: schema.pipelineStage.name,
      kind: schema.pipelineStage.kind,
      position: schema.pipelineStage.position,
    })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));
  const rows = await db
    .select({
      id: schema.lead.id,
      stageId: schema.lead.stageId,
      optedOutAt: schema.contact.optedOutAt,
    })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.lead.contactId))
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, contactId)))
    .limit(1);
  const row = rows[0];
  return {
    stages,
    leadId: row?.id ?? null,
    current: row ? (stages.find((s) => s.id === row.stageId) ?? null) : null,
    optedOut: Boolean(row?.optedOutAt),
  };
}

export type StageTarget = { role: StageRole } | { stageId: string };

/**
 * Avanza el lead del contacto a `target` si las reglas lo permiten. Devuelve
 * la etapa nueva o `null` si no se movió.
 */
export async function advanceLeadStage(
  organizationId: string,
  contactId: string,
  target: StageTarget,
  state?: LeadStageState
): Promise<StageLike | null> {
  try {
    const s = state ?? (await loadLeadStageState(organizationId, contactId));
    if (!s.leadId || !s.current) return null;
    const to =
      "role" in target
        ? (stageRoles(s.stages)[target.role] ?? null)
        : (s.stages.find((st) => st.id === target.stageId) ?? null);
    if (!to || !canAutoMove(s.current, to, { optedOut: s.optedOut })) return null;
    const moved = await getDb()
      .update(schema.lead)
      .set({ stageId: to.id, updatedAt: new Date(), lastActivityAt: new Date() })
      .where(
        and(
          scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, s.leadId)),
          eq(schema.lead.stageId, s.current.id)
        )
      )
      .returning({ id: schema.lead.id });
    if (moved.length === 0) return null;
    // Quien siga usando este estado (el mismo turno) ve la etapa nueva.
    s.current = to;
    return to;
  } catch (err) {
    console.error("[pipeline] no se pudo mover el lead:", err instanceof Error ? err.message : err);
    return null;
  }
}
