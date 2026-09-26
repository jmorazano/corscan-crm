import { getEnv, isInstagramConfigured } from "@/lib/env";
import { parseSignedRequest, readSignedRequest } from "@/lib/instagram/signed-request";
import { deleteInstagramIntegrationByAccount } from "@/server/instagram/integration";

/**
 * Callback de desautorización del Business Login (023): la persona quitó la
 * app desde Instagram. Se borra la conexión de esa cuenta (el token ya no
 * sirve). Auth: `signed_request` firmado con el secreto de la app.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isInstagramConfigured()) return new Response(null, { status: 404 });
  const signedRequest = await readSignedRequest(req);
  const env = getEnv();
  const data = signedRequest
    ? parseSignedRequest(signedRequest, [env.INSTAGRAM_APP_SECRET, env.META_APP_SECRET])
    : null;
  if (!data?.user_id) return new Response(null, { status: 400 });
  await deleteInstagramIntegrationByAccount(data.user_id);
  return Response.json({ success: true });
}
