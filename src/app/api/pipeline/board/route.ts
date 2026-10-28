import { and, asc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { WINDOW_MS } from "@/server/inbox/window";

export const dynamic = "force-dynamic";

/** Datos completos del kanban: etapas ordenadas + tarjetas con su contacto. */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const now = Date.now();

  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, session.organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const leads = await db
    .select({
      lead: schema.lead,
      contact: schema.contact,
      conversationId: schema.conversation.id,
      lastInboundAt: schema.conversation.lastInboundAt,
    })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
    .leftJoin(
      schema.conversation,
      and(
        eq(schema.conversation.contactId, schema.contact.id),
        eq(schema.conversation.isTest, false)
      )
    )
    .where(scoped(schema.lead.organizationId, session.organizationId))
    .orderBy(asc(schema.lead.position));

  return Response.json({
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      kind: s.kind,
    })),
    leads: leads.map((r) => ({
      id: r.lead.id,
      stageId: r.lead.stageId,
      position: r.lead.position,
      lastActivityAt: r.lead.lastActivityAt?.toISOString() ?? null,
      contact: {
        id: r.contact.id,
        name: r.contact.name,
        phone: r.contact.phone,
      },
      conversationId: r.conversationId,
      // 044: hasta cuándo se le puede escribir sin plantilla (null = cerrada).
      windowClosesAt: windowClosesAt(r.lastInboundAt, now),
    })),
  });
});

function windowClosesAt(lastInboundAt: Date | null, now: number): string | null {
  if (!lastInboundAt) return null;
  const closes = lastInboundAt.getTime() + WINDOW_MS;
  return closes > now ? new Date(closes).toISOString() : null;
}
