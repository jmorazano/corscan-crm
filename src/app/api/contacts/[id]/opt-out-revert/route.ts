import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getContactById, serializeContact } from "@/server/contacts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Revierte una baja (004, FR-011): solo explícito y auditado (quién/cuándo).
 * La UI exige confirmación antes de llamar. La baja automática (BAJA/STOP)
 * vive en la ingesta; esto es el único camino de vuelta.
 */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const contact = await getContactById(session.organizationId, id);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");
  if (!contact.optedOutAt) {
    return apiError(409, "not_opted_out", "El contacto no está dado de baja");
  }

  const db = getDb();
  const updated = await db
    .update(schema.contact)
    .set({
      optedOutAt: null,
      optOutRevertedAt: new Date(),
      optOutRevertedBy: session.userId,
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.contact.organizationId,
        session.organizationId,
        eq(schema.contact.id, id)
      )
    )
    .returning();
  return Response.json({ contact: serializeContact(updated[0]!) });
});
