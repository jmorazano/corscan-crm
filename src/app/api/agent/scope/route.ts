import { apiError, parseBody, withAuth, withOwner } from "@/lib/api";
import { agentScopeChangeSchema } from "@/lib/agent-scope";
import { isAiConfigured } from "@/server/ai/credentials";
import { AgentScopeError, getAgentScopeSummary, setAgentScope } from "@/server/ai/agent-scope";

export const dynamic = "force-dynamic";

/** En qué conversaciones responde el agente y cuántas tienen la IA prendida. */
export const GET = withAuth(async (session) => {
  return Response.json({ summary: await getAgentScopeSummary(session.organizationId) });
});

/**
 * Cambia el modo (`selected` apaga la IA de todas las conversaciones; `all`
 * puede prenderlas). `enableAgent` prende el agente de la empresa al final,
 * para el diálogo que aparece al encenderlo.
 */
export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, agentScopeChangeSchema);
  if (!body.ok) return body.response;
  if (body.data.enableAgent && !(await isAiConfigured(session.organizationId))) {
    return apiError(422, "ai_not_configured", "Configurá la IA de la empresa antes de prender el agente.");
  }
  try {
    const result = await setAgentScope(session.organizationId, body.data);
    return Response.json(result);
  } catch (err) {
    if (err instanceof AgentScopeError) return apiError(404, "not_found", err.message);
    throw err;
  }
});
