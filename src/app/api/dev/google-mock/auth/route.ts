import { mockGuard } from "@/lib/dev-guard";
import { getGoogleMockState, nextMockN } from "@/server/dev/google-mock-state";

export const dynamic = "force-dynamic";

/**
 * Pantalla de consentimiento simulada: sin UI, redirige de inmediato al
 * redirect_uri con un `code` (o con `error=access_denied` si el estado del
 * mock lo pide — camino infeliz "el usuario canceló").
 */
export async function GET(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const url = new URL(req.url);
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state") ?? "";
  if (!redirectUri) return new Response("redirect_uri requerido", { status: 400 });
  const back = new URL(redirectUri);
  const s = getGoogleMockState();
  if (s.nextAuthError) {
    back.searchParams.set("error", s.nextAuthError);
    s.nextAuthError = null;
  } else {
    back.searchParams.set("code", `mock-code-${nextMockN()}`);
  }
  back.searchParams.set("state", state);
  return Response.redirect(back.toString(), 302);
}
