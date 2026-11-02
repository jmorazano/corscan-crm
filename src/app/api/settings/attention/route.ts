import { parseBody, withOwner } from "@/lib/api";
import { attentionSettingsInput } from "@/lib/team-attention";
import {
  getAttentionSettings,
  putAttentionSettings,
  userHasPush,
} from "@/server/attention/settings";

export const dynamic = "force-dynamic";

/**
 * 048: aviso al propietario cuando un cliente espera a una persona. Solo el
 * propietario lo ve y lo cambia. `ownerHasPush` avisa si a quien lo
 * configura no le va a llegar (no tiene notificaciones activas acá).
 */
export const GET = withOwner(async (session) => {
  const [settings, ownerHasPush] = await Promise.all([
    getAttentionSettings(session.organizationId),
    userHasPush(session.organizationId, session.userId),
  ]);
  return Response.json({ ...settings, ownerHasPush });
});

export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, attentionSettingsInput);
  if (!body.ok) return body.response;
  const [settings, ownerHasPush] = await Promise.all([
    putAttentionSettings(session.organizationId, body.data),
    userHasPush(session.organizationId, session.userId),
  ]);
  return Response.json({ ...settings, ownerHasPush });
});
