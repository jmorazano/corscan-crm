import { clientIp } from "@/lib/client-ip";
import { oauthErrorResponse, oauthJson, tooManyRequests } from "@/lib/oauth-server/http";
import { oauthError, parseRegisterRequest } from "@/lib/oauth-server/params";
import { checkRateLimit } from "@/lib/rate-limit";
import { registerClient, serializeClientRegistration } from "@/server/assistants/clients";

export const dynamic = "force-dynamic";

/** 10 registros por hora por IP (research D4). */
const REGISTER_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 10 };

/**
 * 040 (RFC 7591, contracts/oauth.md §3): registro dinámico de clientes
 * públicos con retornos de Claude o loopback.
 */
export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req.headers) ?? "local";
  if (!checkRateLimit(`assistant-register:${ip}`, REGISTER_RATE_LIMIT).allowed) return tooManyRequests();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return oauthErrorResponse(oauthError("invalid_client_metadata", "Cuerpo JSON inválido"));
  }
  const parsed = parseRegisterRequest(body);
  if (!parsed.ok) return oauthErrorResponse(parsed.error);
  try {
    const row = await registerClient(parsed.value);
    return oauthJson(serializeClientRegistration(row), 201);
  } catch (err) {
    console.error("[oauth/register] error:", (err as Error)?.message);
    return oauthJson({ error: "server_error", error_description: "Error interno" }, 500);
  }
}
