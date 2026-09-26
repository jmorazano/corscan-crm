import { apiError, withOwner } from "@/lib/api";
import { isMeliConfigured } from "@/lib/env";
import { signState, verifyState } from "@/lib/oauth-state";
import { buildAuthUrl, meliStateSecret, pkceChallenge, pkceVerifier } from "@/lib/meli/oauth";

export const dynamic = "force-dynamic";

/**
 * Inicio del OAuth de Mercado Libre (025): solo el propietario. El `state`
 * va firmado con un secreto DERIVADO (no sirve en el callback de Google ni
 * de Instagram) y el PKCE sale de su nonce: nada que guardar.
 */
export const GET = withOwner(async (session) => {
  if (!isMeliConfigured()) {
    return apiError(409, "not_available", "Mercado Libre no está habilitado en esta instancia");
  }
  const secret = meliStateSecret();
  const state = signState({ orgId: session.organizationId, userId: session.userId }, secret);
  const parsed = verifyState(state, secret);
  if (!parsed) return apiError(500, "internal_error", "No se pudo iniciar la conexión");
  const challenge = pkceChallenge(pkceVerifier(parsed.nonce, secret));
  return Response.redirect(buildAuthUrl(state, challenge), 302);
});
