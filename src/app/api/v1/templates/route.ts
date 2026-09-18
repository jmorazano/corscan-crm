import { withApiKey } from "@/lib/api";
import { listPublicTemplates } from "@/server/public-api/templates";

export const dynamic = "force-dynamic";

/**
 * API pública (014, contrato api.md): plantillas de la empresa de la clave.
 * Por defecto solo las aprobadas (las únicas enviables); `?status=all`
 * incluye pendientes y rechazadas para diagnóstico.
 */
export const GET = withApiKey(async (ctx, req: Request) => {
  const all = new URL(req.url).searchParams.get("status") === "all";
  const templates = await listPublicTemplates(ctx.organizationId, all);
  return Response.json({ templates });
});
