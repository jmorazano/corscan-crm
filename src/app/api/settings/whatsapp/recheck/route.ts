import { apiError, withAuth } from "@/lib/api";
import { getCredentialsByOrg, markConnected } from "@/server/whatsapp/credentials";
import { testConnection } from "@/server/whatsapp/connect";

export const dynamic = "force-dynamic";

/**
 * Reverifica el token GUARDADO contra Meta. Si sigue vivo, la conexión vuelve a
 * `connected` sin pasar por Embedded Signup ni pegar un token nuevo. Útil
 * cuando un error no-auth de Graph (100/200) marcó la conexión por error, o
 * cuando el operador re-otorgó permisos desde Meta.
 */
export const POST = withAuth(async (session) => {
  const creds = await getCredentialsByOrg(session.organizationId);
  if (!creds) return apiError(404, "not_connected", "No hay un número conectado");

  const check = await testConnection(creds.phoneNumberId, creds.token);
  if (!check.ok) {
    const status = check.code === "meta_unavailable" ? 503 : 422;
    return apiError(status, check.code, check.message);
  }
  await markConnected(session.organizationId);
  return Response.json({ ok: true, displayPhoneNumber: check.displayPhoneNumber });
});
