import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { switchWorkspace } from "@/server/workspaces/switch";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  organizationId: z.string().trim().min(1).max(64),
});

/**
 * Cambiar de espacio de trabajo (018, FR-002): solo a empresas de las que
 * el usuario es miembro (403 `not_member`, exista o no la empresa).
 * Idempotente si ya era la activa.
 */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const result = await switchWorkspace({
    userId: session.userId,
    sessionId: session.sessionId,
    organizationId: body.data.organizationId,
  });
  if (!result.ok) return apiError(403, result.code, result.message);
  return Response.json({ ok: true, organizationId: result.organizationId });
});
