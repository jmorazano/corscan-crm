import { apiError, withOwner } from "@/lib/api";
import { isInstagramConfigured } from "@/lib/env";
import { buildInstagramAuthUrl, instagramStateSecret } from "@/lib/instagram/client";
import { signState } from "@/lib/oauth-state";

export const dynamic = "force-dynamic";

/** Inicio del Business Login for Instagram (023): solo el propietario. */
export const GET = withOwner(async (session) => {
  if (!isInstagramConfigured()) {
    return apiError(409, "not_available", "Instagram no está habilitado en esta instancia");
  }
  const state = signState(
    { orgId: session.organizationId, userId: session.userId },
    instagramStateSecret()
  );
  return Response.redirect(buildInstagramAuthUrl(state), 302);
});
