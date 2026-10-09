import { apiError, parseBody, withOwner } from "@/lib/api";
import { bulkDeleteBodySchema, bulkDeleteContacts } from "@/server/contacts-bulk";
import { publish } from "@/server/events/bus";

export const dynamic = "force-dynamic";

/**
 * Borra varios contactos con sus conversaciones y mensajes (033): `ids` o
 * `filter` + `excludeIds` (todos los que coinciden, en todas las páginas).
 * `expectedCount` es la cantidad que la persona confirmó: si la selección ya
 * no la tiene, 409 `selection_changed` y no se borra nada. Igual que el
 * borrado de uno, solo afecta al CRM (WhatsApp no cambia). Solo el
 * propietario: un miembro borra de a uno (403 `forbidden`).
 */
export const POST = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, bulkDeleteBodySchema);
  if (!body.ok) return body.response;
  const result = await bulkDeleteContacts(
    session.organizationId,
    body.data,
    body.data.expectedCount
  );
  if (!result.ok) {
    return apiError(
      409,
      "selection_changed",
      `La selección cambió: ahora son ${result.count} contactos. Revisá y confirmá de nuevo.`,
      { count: result.count }
    );
  }
  for (const conversationId of result.conversationIds) {
    publish(session.organizationId, {
      type: "conversation.deleted",
      data: { conversationId },
    });
  }
  return Response.json({ deleted: result.deleted });
});
