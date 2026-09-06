import { mockGuard } from "@/lib/dev-guard";
import { getGoogleMockState, mockIdToken, nextMockN } from "@/server/dev/google-mock-state";

export const dynamic = "force-dynamic";

/**
 * Endpoint de tokens simulado: canje de `code` y refresh. Un refresh token
 * que termina en `-invalid` o revocado → 400 invalid_grant (camino de
 * "requiere reconexión", research D9).
 */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const form = new URLSearchParams(await req.text());
  const grant = form.get("grant_type");
  const s = getGoogleMockState();

  if (grant === "authorization_code") {
    const code = form.get("code") ?? "";
    if (!code.startsWith("mock-code-")) {
      return Response.json({ error: "invalid_grant", error_description: "Bad code" }, { status: 400 });
    }
    const n = nextMockN();
    const refresh = s.issueInvalidRefresh ? `mock-refresh-${n}-invalid` : `mock-refresh-${n}`;
    s.issueInvalidRefresh = false;
    return Response.json({
      access_token: `mock-access-${n}`,
      refresh_token: refresh,
      expires_in: 3600,
      token_type: "Bearer",
      id_token: mockIdToken(s.accountEmail),
    });
  }

  if (grant === "refresh_token") {
    const refresh = form.get("refresh_token") ?? "";
    if (!refresh.startsWith("mock-refresh-") || refresh.endsWith("-invalid") || s.revoked.has(refresh)) {
      return Response.json(
        { error: "invalid_grant", error_description: "Token has been expired or revoked." },
        { status: 400 }
      );
    }
    return Response.json({
      access_token: `mock-access-${nextMockN()}`,
      expires_in: 3600,
      token_type: "Bearer",
    });
  }

  return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
}
