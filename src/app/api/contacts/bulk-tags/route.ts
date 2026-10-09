import { parseBody, withAuth } from "@/lib/api";
import { bulkContactTagsBodySchema, bulkTagContacts } from "@/server/contacts-bulk";

export const dynamic = "force-dynamic";

/**
 * Agrega/quita etiquetas a varios contactos en una sola operación (006,
 * FR-004/FR-005). Ids ajenos o inexistentes se ignoran. 033: además de
 * `ids`, acepta `filter` + `excludeIds` = todos los que coinciden con los
 * filtros de la lista, en todas las páginas.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bulkContactTagsBodySchema);
  if (!body.ok) return body.response;
  const result = await bulkTagContacts(
    session.organizationId,
    body.data,
    { add: body.data.add, remove: body.data.remove }
  );
  return Response.json({ matched: result.matched, updated: result.updated });
});
