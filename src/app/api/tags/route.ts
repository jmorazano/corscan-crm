import { apiError, withAuth } from "@/lib/api";
import { listTagFacets, parseTagScope } from "@/server/tags";

export const dynamic = "force-dynamic";

/** Catálogo de etiquetas de la empresa con su uso (006, FR-006). */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const scope = parseTagScope(url.searchParams.get("scope"));
  if (!scope) {
    return apiError(422, "invalid_scope", "scope debe ser contacts o conversations");
  }
  const tags = await listTagFacets(session.organizationId, scope);
  return Response.json({ tags });
});
