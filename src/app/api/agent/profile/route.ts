import { apiError, parseBody, withAuth, withOwner } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { resolveTeamSilenceMs, TEAM_SILENCE_DEFAULT_MS } from "@/lib/agent-presence";
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
      // 031: null = 10 min (abajo, el efectivo para la bandeja).
      teamSilenceMs: p.teamSilenceMs,
    },
    defaultReplyDelayMs: getEnv().AGENT_COALESCE_MS,
    defaultTeamSilenceMs: TEAM_SILENCE_DEFAULT_MS,
    effectiveTeamSilenceMs: resolveTeamSilenceMs(p.teamSilenceMs),
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
