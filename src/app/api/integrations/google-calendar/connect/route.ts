import { apiError, withAuth } from "@/lib/api";
import { getEnv, isGoogleIntegrationConfigured } from "@/lib/env";
import { buildAuthUrl, signState } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

/**
 * Inicio del OAuth (contrato integrations-api.md): solo `owner`; el state
 * va firmado y ligado a org + usuario (research D2). 302 a Google.
 */
export const GET = withAuth(async (session) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede conectar Google Calendar");
  }
  if (!isGoogleIntegrationConfigured()) {
    return apiError(409, "not_available", "La integración no está habilitada en esta instancia");
  }
  const state = signState(
    { orgId: session.organizationId, userId: session.userId },
    getEnv().BETTER_AUTH_SECRET
  );
  return Response.redirect(buildAuthUrl(state), 302);
});
