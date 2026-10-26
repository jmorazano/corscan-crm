import { clientIp } from "@/lib/client-ip";
import { oauthJson, tooManyRequests } from "@/lib/oauth-server/http";
import { fieldsFromBody } from "@/lib/oauth-server/params";
import { checkRateLimit } from "@/lib/rate-limit";
import { revokeByToken } from "@/server/assistants/tokens";

export const dynamic = "force-dynamic";

const REVOKE_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 30 };

/**
 * 040 (RFC 7009, contracts/oauth.md §6): siempre 200, exista o no el token.
 * Un token válido cierra la conexión entera.
 */
export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req.headers) ?? "local";
  if (!checkRateLimit(`assistant-revoke:${ip}`, REVOKE_RATE_LIMIT).allowed) return tooManyRequests();
  const fields = fieldsFromBody(req.headers.get("content-type"), await req.text());
  if (fields.token) {
    try {
      await revokeByToken(fields.token);
    } catch (err) {
      console.error("[oauth/revoke] error:", (err as Error)?.message);
    }
  }
  return oauthJson({});
}
