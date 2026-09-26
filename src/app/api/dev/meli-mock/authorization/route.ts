import { mockGuard } from "@/lib/dev-guard";
import { getMeliMockState, nextMeliN } from "@/server/dev/meli-mock-state";

export const dynamic = "force-dynamic";

/**
 * Pantalla de autorización simulada de Mercado Libre: sin UI, redirige al
 * redirect_uri con un `code` (y recuerda el code_challenge para verificar el
 * PKCE en el canje) o con `error=access_denied` si la perilla lo pide.
 */
export async function GET(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const url = new URL(req.url);
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state") ?? "";
  if (!redirectUri || url.searchParams.get("response_type") !== "code") {
    return new Response("redirect_uri y response_type=code requeridos", { status: 400 });
  }
  const back = new URL(redirectUri);
  const s = getMeliMockState();
  if (s.nextAuthError) {
    back.searchParams.set("error", s.nextAuthError);
    s.nextAuthError = null;
  } else {
    const code = `TG-code-mock-${nextMeliN()}`;
    s.codes.set(code, url.searchParams.get("code_challenge"));
    back.searchParams.set("code", code);
  }
  back.searchParams.set("state", state);
  return Response.redirect(back.toString(), 302);
}
