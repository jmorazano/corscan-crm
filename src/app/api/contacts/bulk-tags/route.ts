import { parseBody, withAuth } from "@/lib/api";
import { bulkTagsBodySchema, bulkUpdateContactTags } from "@/server/tags";

export const dynamic = "force-dynamic";

/**
 * Agrega/quita etiquetas a varios contactos en una sola operación (006,
 * FR-004/FR-005). Ids ajenos o inexistentes se ignoran.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bulkTagsBodySchema);
  if (!body.ok) return body.response;
  const result = await bulkUpdateContactTags(
    session.organizationId,
    body.data.ids,
    { add: body.data.add, remove: body.data.remove }
  );
  return Response.json({ matched: result.matched, updated: result.updated });
});
