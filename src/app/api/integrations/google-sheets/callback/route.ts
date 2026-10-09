import { getEnv } from "@/lib/env";
import { requireSession } from "@/lib/auth/session";
import { canManageConfig } from "@/lib/roles";
import { exchangeCode, GoogleAuthError, verifyState } from "@/lib/google/oauth";
import { connectSheetsIntegration } from "@/server/sheets/integration";

export const dynamic = "force-dynamic";

/**
 * Callback del OAuth de Google Sheets (034): SIEMPRE redirige a la página de
 * la integración con `?connected=1` o `?error=…`. Nada de acá loguea el
 * `code` ni tokens.
 */
export async function GET(req: Request): Promise<Response> {
  const env = getEnv();
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  const back = (q: string) => Response.redirect(`${base}/integrations/google-sheets?${q}`, 302);

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

  const parsed = verifyState(state, env.BETTER_AUTH_SECRET);
  if (!parsed || parsed.orgId !== session.organizationId || parsed.userId !== session.userId) {
    return back("error=state");
  }
  if (providerError || !code) {
    return back(providerError === "access_denied" ? "error=cancelled" : "error=exchange");
  }

  try {
    const tokens = await exchangeCode(code, "sheets");
    await connectSheetsIntegration({
      organizationId: session.organizationId,
      userId: session.userId,
      tokens,
    });
  } catch (err) {
    console.error(
      "[planillas] canje de Google falló:",
      err instanceof GoogleAuthError ? `${err.code}: ${err.message}` : err
    );
    return back("error=exchange");
  }
  return back("connected=1");
}
