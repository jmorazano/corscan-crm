import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { stageAfterReply, stageRoles } from "@/lib/lead-stages";
import { advanceLeadStage, loadLeadStageState } from "@/server/inbox/lead-stage";

/**
 * Actividad de lead al recibir un mensaje (US2): si el contacto no tiene lead,
 * se crea en la primera etapa del pipeline; si lo tiene, se actualiza su
 * última actividad.
 *
 * 044: con `conversationId`, si el cliente escribe DESPUÉS de un mensaje del
 * negocio (le contestó al agente, al equipo o a una campaña), el lead pasa de
 * la primera etapa —o de perdido por días sin respuesta— a la de
 * conversación.
 */
export async function onLeadActivity(
  organizationId: string,
  contactId: string,
  at: Date,
  opts: { conversationId?: string } = {}
): Promise<void> {
  const db = getDb();
  const replied = opts.conversationId
    ? await hasOutbound(organizationId, opts.conversationId)
    : false;

  // Defensa en profundidad (Constitución III): aunque el contactId venga de
  // un upsert org-scoped aguas arriba, el WHERE lleva SIEMPRE el tenant.
  const existing = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.lead)
      .set({ lastActivityAt: at, updatedAt: new Date() })
      .where(
        scoped(
          schema.lead.organizationId,
          organizationId,
          eq(schema.lead.id, existing[0].id)
        )
      );
    if (replied) await moveAfterReply(organizationId, contactId);
    return;
  }

  const firstStage = await db
    .select({ id: schema.pipelineStage.id })
    .from(schema.pipelineStage)
    .where(
      and(
        eq(schema.pipelineStage.organizationId, organizationId),
        eq(schema.pipelineStage.kind, "open")
      )
    )
    .orderBy(asc(schema.pipelineStage.position))
    .limit(1);
  if (!firstStage[0]) return; // pipeline sin etapas abiertas: no hay dónde crear

  const maxPos = await db
    .select({ max: sql<number>`coalesce(max(${schema.lead.position}), -1)` })
    .from(schema.lead)
    .where(
      and(
        eq(schema.lead.organizationId, organizationId),
        eq(schema.lead.stageId, firstStage[0].id)
      )
    );

  await db
    .insert(schema.lead)
    .values({
      id: newId("lead"),
      organizationId,
      contactId,
      stageId: firstStage[0].id,
      position: (maxPos[0]?.max ?? -1) + 1,
      lastActivityAt: at,
    })
    .onConflictDoNothing({ target: [schema.lead.contactId] });
  if (replied) await moveAfterReply(organizationId, contactId);
}

/**
 * 044: el cliente respondió. De la primera etapa pasa a la de conversación;
 * de perdido solo si llegó ahí por días sin respuesta (`stageAfterReply`).
 */
async function moveAfterReply(organizationId: string, contactId: string): Promise<void> {
  try {
    const state = await loadLeadStageState(organizationId, contactId);
    const target = stageAfterReply(state.current, stageRoles(state.stages), state);
    if (target) await advanceLeadStage(organizationId, contactId, { stageId: target.id }, state);
  } catch (err) {
    console.error("[pipeline] no se pudo mover el lead tras la respuesta:", err instanceof Error ? err.message : err);
  }
}

/** ¿El negocio ya le escribió en esta conversación? */
async function hasOutbound(organizationId: string, conversationId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.message.id })
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        and(
          eq(schema.message.conversationId, conversationId),
          eq(schema.message.direction, "out")
        )
      )
    )
    .limit(1);
  return rows.length > 0;
}
