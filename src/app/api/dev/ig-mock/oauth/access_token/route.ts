import { mockGuard } from "@/lib/dev-guard";
import { getEnv } from "@/lib/env";
import { getIgMockState, nextIgN } from "@/server/dev/ig-mock-state";

export const dynamic = "force-dynamic";

/** Canje `code` → token corto (formato `{data:[…]}` como la doc de Meta). */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const form = await req.formData();
  const code = String(form.get("code") ?? "");
  const secret = String(form.get("client_secret") ?? "");
  if (secret !== getEnv().INSTAGRAM_APP_SECRET) {
    return Response.json(
      { error_type: "OAuthException", code: 400, error_message: "Invalid client secret" },
      { status: 400 }
    );
  }
  if (!code.startsWith("mock-ig-code-")) {
    return Response.json(
      { error_type: "OAuthException", code: 400, error_message: "Matching code was not found or was already used" },
      { status: 400 }
    );
  }
  const s = getIgMockState();
  return Response.json({
    data: [
      {
        access_token: `mock-ig-short-${nextIgN()}`,
        user_id: s.account.igUserId,
        permissions: "instagram_business_basic,instagram_business_manage_messages",
      },
    ],
  });
}
