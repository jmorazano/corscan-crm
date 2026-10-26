import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  ACCESS_TTL_S,
  ASSISTANT_SCOPE,
  REFRESH_TTL_S,
  generateAccessToken,
  generateRefreshToken,
  hashSecret,
  isIdle,
  looksLikeAccessToken,
  looksLikeRefreshToken,
  secondsFrom,
} from "@/lib/oauth-server/tokens";
import { expireGrant, revokeGrant } from "./grants";

/**
 * Emisión, renovación con rotación y revocación de tokens de los asistentes
 * (040, research D5, FR-006). En la base solo viven los hashes.
 */

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export async function issueTokens(grantId: string, now: Date = new Date()): Promise<TokenResponse> {
  const accessToken = generateAccessToken();
  const refreshToken = generateRefreshToken();
  await getDb()
    .insert(schema.assistantToken)
    .values([
      {
        tokenHash: hashSecret(accessToken),
        grantId,
        kind: "access",
        expiresAt: secondsFrom(now, ACCESS_TTL_S),
        createdAt: now,
      },
      {
        tokenHash: hashSecret(refreshToken),
        grantId,
        kind: "refresh",
        expiresAt: secondsFrom(now, REFRESH_TTL_S),
        createdAt: now,
      },
    ]);
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: refreshToken,
    scope: ASSISTANT_SCOPE,
  };
}

export type RefreshOutcome =
  | { ok: true; tokens: TokenResponse }
  | { ok: false; error: "invalid_grant"; description: string };

export async function refreshTokens(
  refreshToken: string,
  clientId: string,
  now: Date = new Date()
): Promise<RefreshOutcome> {
  const fail = (description: string): RefreshOutcome => ({ ok: false, error: "invalid_grant", description });
  if (!looksLikeRefreshToken(refreshToken)) return fail("Token de renovación inválido");
  const db = getDb();
  const tokenHash = hashSecret(refreshToken);
  const rows = await db
    .select({ token: schema.assistantToken, grant: schema.assistantGrant })
    .from(schema.assistantToken)
    .innerJoin(schema.assistantGrant, eq(schema.assistantGrant.id, schema.assistantToken.grantId))
    .where(and(eq(schema.assistantToken.tokenHash, tokenHash), eq(schema.assistantToken.kind, "refresh")))
    .limit(1);
  const found = rows[0];
  if (!found) return fail("Token de renovación inválido");
  const { token, grant } = found;
  if (grant.clientId !== clientId) return fail("Token de renovación inválido");
  if (grant.status !== "active") return fail("La conexión ya no está activa: volvé a conectar el asistente");
  if (token.usedAt) {
    // Reuso de un refresh ya canjeado: alguien más lo tiene. Se corta todo.
    await revokeGrant(grant.id, "refresh_reuse", null, now);
    return fail("Token de renovación ya usado: la conexión se cerró por seguridad");
  }
  if (token.expiresAt.getTime() <= now.getTime()) return fail("Token de renovación vencido");
  if (isIdle(grant.lastUsedAt, grant.createdAt, now)) {
    await expireGrant(grant.id, now);
    return fail("La conexión venció por falta de uso: volvé a conectar el asistente");
  }
  const burned = await db
    .update(schema.assistantToken)
    .set({ usedAt: now })
    .where(and(eq(schema.assistantToken.tokenHash, tokenHash), isNull(schema.assistantToken.usedAt)))
    .returning({ tokenHash: schema.assistantToken.tokenHash });
  if (burned.length === 0) {
    await revokeGrant(grant.id, "refresh_reuse", null, now);
    return fail("Token de renovación ya usado: la conexión se cerró por seguridad");
  }
  await db.update(schema.assistantGrant).set({ lastUsedAt: now }).where(eq(schema.assistantGrant.id, grant.id));
  return { ok: true, tokens: await issueTokens(grant.id, now) };
}

/** RFC 7009: un token válido revoca la conexión entera. Nunca falla hacia afuera. */
export async function revokeByToken(token: string, now: Date = new Date()): Promise<void> {
  if (!looksLikeAccessToken(token) && !looksLikeRefreshToken(token)) return;
  const rows = await getDb()
    .select({ grantId: schema.assistantToken.grantId, userId: schema.assistantGrant.userId })
    .from(schema.assistantToken)
    .innerJoin(schema.assistantGrant, eq(schema.assistantGrant.id, schema.assistantToken.grantId))
    .where(eq(schema.assistantToken.tokenHash, hashSecret(token)))
    .limit(1);
  const row = rows[0];
  if (row) await revokeGrant(row.grantId, "user", row.userId, now);
}
