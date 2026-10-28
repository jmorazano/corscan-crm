import { apiError, parseBody, withAuth, withOwner } from "@/lib/api";
import {
  followUpSettingsSchema,
  FollowUpSettingsError,
  followUpSummary,
  getFollowUpSettings,
  updateFollowUpSettings,
} from "@/server/follow-up/settings";

export const dynamic = "force-dynamic";

/** 042: configuración del seguimiento automático + resumen de 7 días. */
export const GET = withAuth(async (session) => {
  const settings = await getFollowUpSettings(session.organizationId);
  if (!settings) return apiError(404, "not_found", "Perfil del agente no encontrado");
  return Response.json({ settings, summary: await followUpSummary(session.organizationId) });
});

export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, followUpSettingsSchema);
  if (!body.ok) return body.response;
  try {
    const settings = await updateFollowUpSettings(session.organizationId, body.data);
    return Response.json({ settings });
  } catch (err) {
    if (err instanceof FollowUpSettingsError) {
      return apiError(err.code === "not_found" ? 404 : 422, err.code, err.message);
    }
    throw err;
  }
});
