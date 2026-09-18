import { withAuth } from "@/lib/api";
import { sendTestNotification } from "@/server/push/events";

export const dynamic = "force-dynamic";

/** Prueba a los dispositivos del usuario (013, FR-004). */
export const POST = withAuth(async (session) => {
  const result = await sendTestNotification(session.organizationId, session.userId);
  return Response.json(result);
});
