import { parseBody, withAuth } from "@/lib/api";
import { publish } from "@/server/events/bus";
import { bulkTagsBodySchema, bulkUpdateConversationTags } from "@/server/tags";

export const dynamic = "force-dynamic";

/**
 * Agrega/quita etiquetas a varias conversaciones (006, FR-004/FR-005/FR-007).
 * Un solo evento SSE por operación con los ids modificados.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bulkTagsBodySchema);
  if (!body.ok) return body.response;
  const result = await bulkUpdateConversationTags(
    session.organizationId,
    body.data.ids,
    { add: body.data.add, remove: body.data.remove }
  );
  if (result.updatedIds.length > 0) {
    publish(session.organizationId, {
      type: "conversations.updated",
      data: { conversationIds: result.updatedIds },
    });
  }
  return Response.json({ matched: result.matched, updated: result.updated });
});
