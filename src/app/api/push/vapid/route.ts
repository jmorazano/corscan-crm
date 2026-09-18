import { withAuth } from "@/lib/api";
import { getOrCreateVapidKeys } from "@/server/push/keys";

export const dynamic = "force-dynamic";

/** Clave pública VAPID de la empresa (013, FR-002): solo autenticados. */
export const GET = withAuth(async (session) => {
  const keys = await getOrCreateVapidKeys(session.organizationId);
  return Response.json({ publicKey: keys.publicKey });
});
