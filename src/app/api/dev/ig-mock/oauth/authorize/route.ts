import { mockGuard } from "@/lib/dev-guard";
import { getIgMockState, nextIgN } from "@/server/dev/ig-mock-state";

export const dynamic = "force-dynamic";

/**
 * Ventana de autorización de Instagram simulada: sin UI, vuelve de
 * inmediato al redirect_uri con un `code` (o con el error que pida la
 * perilla — camino infeliz «el usuario canceló»).
 */
export async function GET(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const url = new URL(req.url);
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state") ?? "";
  if (!redirectUri) return new Response("redirect_uri requerido", { status: 400 });
  const scope = url.searchParams.get("scope") ?? "";
  if (!scope.includes("instagram_business_manage_messages")) {
    return new Response("scope sin instagram_business_manage_messages", { status: 400 });
  }
  const back = new URL(redirectUri);
  const s = getIgMockState();
  if (s.nextAuthError) {
    back.searchParams.set("error", s.nextAuthError);
    back.searchParams.set("error_reason", "user_denied");
    s.nextAuthError = null;
  } else {
    // Instagram real agrega `#_` al final: el callback debe tolerarlo.
    back.searchParams.set("code", `mock-ig-code-${nextIgN()}`);
  }
  back.searchParams.set("state", state);
  return Response.redirect(back.toString(), 302);
}
