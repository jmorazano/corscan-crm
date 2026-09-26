import { getEnv } from "@/lib/env";
import { requireSession } from "@/lib/auth/session";
import { canManageConfig } from "@/lib/roles";
import { verifyState } from "@/lib/oauth-state";
import { instagramStateSecret } from "@/lib/instagram/client";
import {
  connectInstagram,
  InstagramConnectError,
} from "@/server/instagram/integration";

export const dynamic = "force-dynamic";

/**
 * Vuelta del Business Login for Instagram (023): SIEMPRE redirige a la
 * página de la integración con `?connected=1` o `?error=…`. Nada de acá
 * loguea el `code` ni tokens.
 */
export async function GET(req: Request): Promise<Response> {
  const env = getEnv();
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  const back = (q: string) => Response.redirect(`${base}/integrations/instagram?${q}`, 302);

  const url = new URL(req.url);
  // Instagram agrega `#_` al final del code: se descarta si viniera pegado.
  const code = url.searchParams.get("code")?.replace(/#_$/, "") ?? null;
  const state = url.searchParams.get("state") ?? "";
  const providerError = url.searchParams.get("error");

  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.redirect(`${base}/login`, 302);
  }
  if (!canManageConfig(session.role)) return back("error=forbidden");

  const parsed = verifyState(state, instagramStateSecret());
  if (!parsed || parsed.orgId !== session.organizationId || parsed.userId !== session.userId) {
    return back("error=state");
  }
  if (providerError || !code) {
    const denied =
      providerError === "access_denied" ||
      url.searchParams.get("error_reason") === "user_denied";
    return back(denied ? "error=cancelled" : "error=exchange");
  }

  try {
    await connectInstagram({
      organizationId: session.organizationId,
      userId: session.userId,
      code,
    });
  } catch (err) {
    const code = err instanceof InstagramConnectError ? err.code : "exchange";
    console.error(
      "[integraciones] conexión de Instagram falló:",
      err instanceof InstagramConnectError ? `${err.code}: ${err.message}` : err
    );
    return back(`error=${code === "account_in_use" || code === "subscribe" ? code : "exchange"}`);
  }
  return back("connected=1");
}
