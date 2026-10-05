import { withOwner } from "@/lib/api";
import { getInstagramIntegrationView } from "@/server/instagram/integration";
import { listCommentActivity, listCommentRules, listEntryLinks } from "@/server/instagram/profile";

export const dynamic = "force-dynamic";

/**
 * 030: todo lo de «Instagram que vende» de la empresa en un pedido: reglas
 * de comentarios, actividad reciente, links con origen y el primer contacto.
 */
export const GET = withOwner(async (session) => {
  const [integration, rules, activity, links] = await Promise.all([
    getInstagramIntegrationView(session.organizationId),
    listCommentRules(session.organizationId),
    listCommentActivity(session.organizationId),
    listEntryLinks(session.organizationId),
  ]);
  return Response.json({ integration, rules, activity, links });
});
