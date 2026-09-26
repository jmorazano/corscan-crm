import { mockGuard } from "@/lib/dev-guard";
import { getMeliMockState, nextMeliN, s256 } from "@/server/dev/meli-mock-state";

export const dynamic = "force-dynamic";

/**
 * Tokens simulados de Mercado Libre: canje del code (verificando PKCE) y
 * refresh con ROTACIÓN — el refresh es de un solo uso: el viejo muere en
 * cuanto se emite el nuevo, como en ML.
 */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const form = new URLSearchParams(await req.text());
  const s = getMeliMockState();
  const grant = form.get("grant_type");
  const bad = (error: string, status = 400) =>
    Response.json({ error, message: error, status }, { status });

  if (!form.get("client_id") || !form.get("client_secret")) return bad("invalid_client", 401);

  const issue = () => {
    const n = nextMeliN();
    const access = `APP_USR-mock-${n}-${s.userId}`;
    const refresh = `TG-mock-${n}-${s.userId}`;
    s.validAccess.add(access);
    s.currentRefresh = refresh;
    return Response.json({
      access_token: access,
      token_type: "Bearer",
      expires_in: 21600,
      scope: "offline_access read",
      user_id: Number(s.userId),
      refresh_token: refresh,
    });
  };

  if (grant === "authorization_code") {
    s.calls.token++;
    const code = form.get("code") ?? "";
    if (!s.codes.has(code)) return bad("invalid_grant");
    const challenge = s.codes.get(code) ?? null;
    s.codes.delete(code);
    if (challenge && s256(form.get("code_verifier") ?? "") !== challenge) return bad("invalid_grant");
    s.revoked = false;
    return issue();
  }

  if (grant === "refresh_token") {
    s.calls.refresh++;
    const refresh = form.get("refresh_token") ?? "";
    if (s.revoked || !s.currentRefresh || refresh !== s.currentRefresh) return bad("invalid_grant");
    return issue();
  }

  return bad("unsupported_grant_type");
}
