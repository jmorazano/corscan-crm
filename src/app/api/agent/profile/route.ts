import { apiError, parseBody, withAuth } from "@/lib/api";
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
    },
    aiConfigured: await isAiConfigured(session.organizationId),
  });
});

export const PUT = withAuth(async (session, req: Request) => {
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
