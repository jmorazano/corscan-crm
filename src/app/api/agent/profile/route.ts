import { apiError, parseBody, withAuth, withOwner } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { isAiConfigured } from "@/server/ai/credentials";
import {
  getProfile,
  ProfileError,
  profileUpdateSchema,
  updateProfile,
} from "@/server/ai/profile";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const p = await getProfile(session.organizationId);
  if (!p) return apiError(404, "not_found", "Perfil del agente no encontrado");
  return Response.json({
    profile: {
      enabled: p.enabled,
      name: p.name,
      tone: p.tone,
      instructions: p.instructions,
      escalationRules: p.escalationRules,
      greeting: p.greeting,
      // 022: null = usa el default de instancia que va abajo.
      replyDelayMs: p.replyDelayMs,
      // 025: con esto el agente no le contesta a conocidos del celular.
      sharedPersonalNumber: p.sharedPersonalNumber,
    },
    defaultReplyDelayMs: getEnv().AGENT_COALESCE_MS,
    aiConfigured: await isAiConfigured(session.organizationId),
  });
});

export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, profileUpdateSchema);
  if (!body.ok) return body.response;
  try {
    await updateProfile(session.organizationId, body.data);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof ProfileError) {
      return apiError(err.code === "not_found" ? 404 : 422, err.code, err.message);
    }
    throw err;
  }
});
