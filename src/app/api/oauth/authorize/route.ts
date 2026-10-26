import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { clientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  approveAuthorization,
  assistantBase,
  denyRedirect,
  validateAuthorize,
} from "@/server/assistants/authorize";

export const dynamic = "force-dynamic";

const AUTHORIZE_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 30 };

const bodySchema = z.object({
  client_id: z.string().max(64),
  redirect_uri: z.string().max(2048),
  code_challenge: z.string().max(128),
  code_challenge_method: z.string().max(10),
  state: z.string().max(1024).optional(),
  resource: z.string().max(2048).optional(),
  decision: z.enum(["allow", "deny"]),
  organization_ids: z.array(z.string().max(64)).max(50).default([]),
});

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(assistantBase()).origin;
  } catch {
    return false;
  }
}

/**
 * 040 (contracts/oauth.md §4): lo llama el consentimiento. Sesión del CRM +
 * mismo origen (anti-CSRF); se valida TODO de nuevo y se recalculan las
 * empresas autorizables en el servidor.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!sameOrigin(req)) return apiError(403, "forbidden", "Origen no permitido");
  const ip = clientIp(req.headers) ?? "local";
  if (!checkRateLimit(`assistant-authorize:${ip}`, AUTHORIZE_RATE_LIMIT).allowed) {
    return apiError(429, "rate_limited", "Demasiados intentos: esperá unos minutos");
  }
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const b = body.data;
  const { validation } = await validateAuthorize({
    response_type: "code",
    client_id: b.client_id,
    redirect_uri: b.redirect_uri,
    code_challenge: b.code_challenge,
    code_challenge_method: b.code_challenge_method,
    state: b.state,
    resource: b.resource,
  });
  if (validation.kind === "fatal") return apiError(400, "invalid_request", validation.message);
  if (validation.kind === "redirect") {
    return apiError(400, "invalid_request", validation.description);
  }
  if (b.decision === "deny") return Response.json({ redirect: denyRedirect(validation.request) });
  const result = await approveAuthorization({
    userId: session.userId,
    request: validation.request,
    organizationIds: b.organization_ids,
  });
  if (!result.ok) {
    return apiError(422, "no_workspaces", "Elegí al menos una empresa que puedas autorizar");
  }
  return Response.json({ redirect: result.redirect });
});
