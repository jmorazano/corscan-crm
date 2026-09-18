import { apiError, withApiKey } from "@/lib/api";
import { getPublicMessage } from "@/server/public-api/messages";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** API pública (014, FR-008): estado de un mensaje de la empresa. */
export const GET = withApiKey(async (ctx, _req: Request, routeCtx: Params) => {
  const { id } = await routeCtx.params;
  const message = await getPublicMessage(ctx.organizationId, id);
  if (!message) return apiError(404, "not_found", "Mensaje no encontrado");
  return Response.json({ message });
});
