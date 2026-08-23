import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

export function serializeContact(c: typeof schema.contact.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    archivedAt: c.archivedAt?.toISOString() ?? null,
  };
}

export async function getContactById(
  organizationId: string,
  contactId: string
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contactId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Etapa actual del lead del contacto (si existe). */
export async function getContactStage(
  organizationId: string,
  contactId: string
) {
  const db = getDb();
  const rows = await db
    .select({ stage: schema.pipelineStage, lead: schema.lead })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      eq(schema.lead.stageId, schema.pipelineStage.id)
    )
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Borra un contacto con todo lo suyo (leads, conversaciones y mensajes caen
 * por cascada). Devuelve los ids de sus conversaciones para poder anunciar
 * `conversation.deleted` por SSE, o null si el contacto no existe en la
 * organización. Es también el mecanismo con el que la instancia cumple los
 * pedidos de eliminación de datos (Ley 25.326).
 */
export async function deleteContact(
  organizationId: string,
  contactId: string
): Promise<{ conversationIds: string[] } | null> {
  const db = getDb();
  // Transacción: el SELECT de conversaciones y el DELETE ven el mismo
  // estado — una conversación creada en el medio (webhook entrante) no puede
  // borrarse por cascada sin haber sido anunciada por SSE.
  return db.transaction(async (tx) => {
    const conversations = await tx
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(
        scoped(
          schema.conversation.organizationId,
          organizationId,
          eq(schema.conversation.contactId, contactId)
        )
      );
    const deleted = await tx
      .delete(schema.contact)
      .where(
        scoped(
          schema.contact.organizationId,
          organizationId,
          eq(schema.contact.id, contactId)
        )
      )
      .returning({ id: schema.contact.id });
    if (deleted.length === 0) return null;
    return { conversationIds: conversations.map((c) => c.id) };
  });
}
