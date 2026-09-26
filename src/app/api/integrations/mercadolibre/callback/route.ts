import { getEnv } from "@/lib/env";
import { requireSession } from "@/lib/auth/session";
import { canManageConfig } from "@/lib/roles";
import { verifyState } from "@/lib/oauth-state";
import { exchangeCode, MeliAuthError, meliStateSecret, pkceVerifier } from "@/lib/meli/oauth";
import { getMe, MeliApiError } from "@/lib/meli/client";
import { connectMeliIntegration, MeliConflictError } from "@/server/meli/integration";
import { syncListingsInBackground } from "@/server/meli/sync";

export const dynamic = "force-dynamic";

/**
 * Callback del OAuth de Mercado Libre (025): SIEMPRE redirige a la página de
 * la integración con `?connected=1` o `?error=…`. Nada de acá loguea el
 * `code` ni tokens. Tras conectar, la primera sync arranca en segundo plano.
 */
export async function GET(req: Request): Promise<Response> {
  const base = getEnv().APP_BASE_URL.replace(/\/$/, "");
  const back = (q: string) => Response.redirect(`${base}/integrations/mercadolibre?${q}`, 302);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const providerError = url.searchParams.get("error");

  let session;
  try {
    session = await requireSession();
  } catch {
    return Response.redirect(`${base}/login`, 302);
  }
  if (!canManageConfig(session.role)) return back("error=forbidden");

  const secret = meliStateSecret();
  const parsed = verifyState(state, secret);
  if (!parsed || parsed.orgId !== session.organizationId || parsed.userId !== session.userId) {
    return back("error=state");
  }
  if (providerError || !code) {
    return back(providerError === "access_denied" ? "error=cancelled" : "error=exchange");
  }

  try {
    const tokens = await exchangeCode(code, pkceVerifier(parsed.nonce, secret));
    const user = await getMe(tokens.accessToken);
    if (tokens.userId && tokens.userId !== user.id) {
      return back("error=exchange");
    }
    await connectMeliIntegration({
      organizationId: session.organizationId,
      userId: session.userId,
      tokens,
      user,
    });
  } catch (err) {
    if (err instanceof MeliConflictError) return back("error=account_in_use");
    console.error(
      "[integraciones] canje de Mercado Libre falló:",
      err instanceof MeliAuthError || err instanceof MeliApiError ? `${err.code}: ${err.message}` : err
    );
    return back("error=exchange");
  }

  syncListingsInBackground(session.organizationId);
  return back("connected=1");
}
