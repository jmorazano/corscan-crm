import { clientIp } from "@/lib/client-ip";
import { oauthErrorResponse, oauthJson, tooManyRequests } from "@/lib/oauth-server/http";
import { fieldsFromBody, oauthError, parseTokenRequest } from "@/lib/oauth-server/params";
import { clientLabelFor } from "@/lib/oauth-server/redirect-uris";
import { checkRateLimit } from "@/lib/rate-limit";
import { assistantResource } from "@/server/assistants/authorize";
import { getClient } from "@/server/assistants/clients";
import { linkCodeToGrant, redeemAuthCode } from "@/server/assistants/codes";
import { createGrant } from "@/server/assistants/grants";
import { issueTokens, refreshTokens } from "@/server/assistants/tokens";

export const dynamic = "force-dynamic";

/** 30 pedidos cada 10 minutos por IP (research D13). */
const TOKEN_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 30 };

/**
 * 040 (contracts/oauth.md §5): canje del código con PKCE y renovación con
 * rotación. Cliente desconocido → 401 `invalid_client` (Claude re-registra).
 */
export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req.headers) ?? "local";
  if (!checkRateLimit(`assistant-token:${ip}`, TOKEN_RATE_LIMIT).allowed) return tooManyRequests();
  const fields = fieldsFromBody(req.headers.get("content-type"), await req.text());
  const resource = assistantResource();
  const parsed = parseTokenRequest(fields, { resource });
  if (!parsed.ok) return oauthErrorResponse(parsed.error);
  const request = parsed.value;

  try {
    const client = await getClient(request.clientId);
    if (!client) {
      return oauthErrorResponse(oauthError("invalid_client", "Cliente desconocido: registralo de nuevo"), 401);
    }

    if (request.grantType === "refresh_token") {
      const out = await refreshTokens(request.refreshToken, client.id);
      if (!out.ok) return oauthErrorResponse(oauthError(out.error, out.description));
      return oauthJson(out.tokens);
    }

    const redeemed = await redeemAuthCode(request.code, {
      clientId: client.id,
      redirectUri: request.redirectUri,
      codeVerifier: request.codeVerifier,
    });
    if (!redeemed.ok) {
      return oauthErrorResponse(oauthError("invalid_grant", "Código inválido, vencido o ya usado"));
    }
    const grantId = await createGrant({
      userId: redeemed.row.userId,
      clientId: client.id,
      clientLabel: clientLabelFor(redeemed.row.redirectUri),
      organizationIds: redeemed.row.organizationIds,
      resource: redeemed.row.resource,
    });
    await linkCodeToGrant(request.code, grantId);
    return oauthJson(await issueTokens(grantId));
  } catch (err) {
    console.error("[oauth/token] error:", (err as Error)?.message);
    return oauthJson({ error: "server_error", error_description: "Error interno" }, 500);
  }
}
