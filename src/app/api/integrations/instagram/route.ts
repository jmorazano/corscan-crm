import { withAuth, withOwner } from "@/lib/api";
import { isInstagramConfigured } from "@/lib/env";
import { canManageConfig } from "@/lib/roles";
import {
  disconnectInstagram,
  getInstagramIntegrationView,
} from "@/server/instagram/integration";

export const dynamic = "force-dynamic";

/** Estado de la conexión de Instagram de la empresa (023). Sin token, jamás. */
export const GET = withAuth(async (session) => {
  const integration = await getInstagramIntegrationView(session.organizationId);
  return Response.json({
    available: isInstagramConfigured(),
    integration,
    canManage: canManageConfig(session.role),
  });
});

/** Desconecta la cuenta: borra el token y deja de recibir mensajes. */
export const DELETE = withOwner(async (session) => {
  const removed = await disconnectInstagram(session.organizationId);
  return Response.json({ disconnected: removed });
});
