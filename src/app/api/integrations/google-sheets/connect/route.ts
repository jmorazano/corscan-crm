import { apiError, withOwner } from "@/lib/api";
import { getEnv, isGoogleIntegrationConfigured } from "@/lib/env";
import { buildAuthUrl, signState } from "@/lib/google/oauth";
import { getSheetsIntegrationView } from "@/server/sheets/integration";

export const dynamic = "force-dynamic";

/**
 * Inicio del OAuth de Google Sheets (034): solo `owner`, state firmado y
 * ligado a org + usuario. Una RECONEXIÓN sugiere la misma cuenta: con
 * `drive.file` el acceso a cada planilla es de ESA cuenta.
 */
export const GET = withOwner(async (session) => {
  if (!isGoogleIntegrationConfigured()) {
    return apiError(409, "not_available", "La integración no está habilitada en esta instancia");
  }
  const current = await getSheetsIntegrationView(session.organizationId);
  const state = signState(
    { orgId: session.organizationId, userId: session.userId },
    getEnv().BETTER_AUTH_SECRET
  );
  return Response.redirect(
    buildAuthUrl(state, "sheets", { loginHint: current?.accountEmail ?? null }),
    302
  );
});
