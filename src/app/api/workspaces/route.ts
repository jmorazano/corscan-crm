import { withAuth } from "@/lib/api";
import { listWorkspaces } from "@/server/workspaces/list";

export const dynamic = "force-dynamic";

/**
 * Espacios de trabajo del usuario (018, contrato api.md): empresas de las
 * que es miembro, en el orden del rail, con acento y no leídos, más la
 * activa de esta sesión.
 */
export const GET = withAuth(async (session) => {
  const workspaces = await listWorkspaces(session.userId);
  return Response.json({ active: session.organizationId, workspaces });
});
