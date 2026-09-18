import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { friendlyDeliveryError } from "@/lib/meta-errors";

/**
 * Estado de un mensaje enviado por la API (014, FR-008). Solo mensajes de
 * la empresa de la clave; el motivo de fallo se traduce con la misma tabla
 * que la bandeja (010).
 */
export async function getPublicMessage(organizationId: string, messageId: string) {
  const db = getDb();
  const rows = await db
    .select({
      message: schema.message,
      templateName: schema.template.name,
      phone: schema.contact.phone,
    })
    .from(schema.message)
    .innerJoin(schema.conversation, eq(schema.conversation.id, schema.message.conversationId))
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .leftJoin(schema.template, eq(schema.template.id, schema.message.templateId))
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.id, messageId),
        eq(schema.message.direction, "out")
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const m = row.message;
  return {
    id: m.id,
    status: m.status,
    error: m.status === "failed" ? friendlyDeliveryError(m.error) : null,
    error_raw: m.error ?? null,
    template: row.templateName ?? null,
    to: row.phone,
    conversation_id: m.conversationId,
    created_at: m.createdAt.toISOString(),
  };
}
