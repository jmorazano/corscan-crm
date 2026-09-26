import { createHash } from "node:crypto";
import { getEnv, isInstagramConfigured } from "@/lib/env";
import { parseSignedRequest, readSignedRequest } from "@/lib/instagram/signed-request";
import { deleteInstagramIntegrationByAccount } from "@/server/instagram/integration";

/**
 * Callback de eliminación de datos del Business Login (023). Meta exige
 * responder `{ url, confirmation_code }`: la URL explica el estado del
 * pedido en lenguaje humano (la página pública de eliminación de datos) y
 * el código lo identifica. Se borra la conexión (token incluido) de esa
 * cuenta; las conversaciones del negocio con sus clientes son datos de la
 * empresa cliente y se eliminan desde el CRM según la política publicada.
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

  // Código estable por cuenta + momento del pedido: no expone el ID.
  const confirmationCode = createHash("sha256")
    .update(`${data.user_id}:${data.issued_at ?? Date.now()}`)
    .digest("hex")
    .slice(0, 16);
  const statusUrl = env.APP_PRIVACY_URL
    ? env.APP_PRIVACY_URL.replace(/\/privacidad\/?$/, "/eliminacion-datos")
    : `${env.APP_BASE_URL.replace(/\/$/, "")}/`;
  return Response.json({
    url: `${statusUrl}${statusUrl.includes("?") ? "&" : "?"}codigo=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}
