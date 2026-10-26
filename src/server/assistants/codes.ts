import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { verifyS256 } from "@/lib/oauth-server/pkce";
import { CODE_TTL_S, generateAuthCode, hashSecret, looksLikeAuthCode, secondsFrom } from "@/lib/oauth-server/tokens";
import { revokeGrant } from "./grants";

/**
 * Código de autorización (040, research D5): hasheado, 5 minutos, un solo
 * uso, atado al cliente, al retorno, al challenge PKCE y a las empresas
 * elegidas. Si se reusa, se revoca lo que se emitió con él.
 */

export type AuthCodeRow = typeof schema.assistantAuthCode.$inferSelect;

export async function createAuthCode(
  input: {
    clientId: string;
    userId: string;
    organizationIds: readonly string[];
    redirectUri: string;
    codeChallenge: string;
    resource: string;
  },
  now: Date = new Date()
): Promise<string> {
  const code = generateAuthCode();
  await getDb()
    .insert(schema.assistantAuthCode)
    .values({
      codeHash: hashSecret(code),
      clientId: input.clientId,
      userId: input.userId,
      organizationIds: [...new Set(input.organizationIds)],
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      resource: input.resource,
      expiresAt: secondsFrom(now, CODE_TTL_S),
    });
  return code;
}

export async function redeemAuthCode(
  code: string,
  check: { clientId: string; redirectUri: string; codeVerifier: string },
  now: Date = new Date()
): Promise<{ ok: true; row: AuthCodeRow } | { ok: false }> {
  if (!looksLikeAuthCode(code)) return { ok: false };
  const db = getDb();
  const codeHash = hashSecret(code);
  const rows = await db
    .select()
    .from(schema.assistantAuthCode)
    .where(eq(schema.assistantAuthCode.codeHash, codeHash))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false };
  if (row.usedAt) {
    if (row.grantId) await revokeGrant(row.grantId, "code_reuse", null, now);
    return { ok: false };
  }
  // Se quema en el primer intento, salga bien o mal: sin fuerza bruta del verifier.
  const burned = await db
    .update(schema.assistantAuthCode)
    .set({ usedAt: now })
    .where(and(eq(schema.assistantAuthCode.codeHash, codeHash), isNull(schema.assistantAuthCode.usedAt)))
    .returning({ codeHash: schema.assistantAuthCode.codeHash });
  if (burned.length === 0) return { ok: false };
  if (
    row.expiresAt.getTime() <= now.getTime() ||
    row.clientId !== check.clientId ||
    row.redirectUri !== check.redirectUri ||
    !verifyS256(check.codeVerifier, row.codeChallenge)
  ) {
    return { ok: false };
  }
  return { ok: true, row };
}

export async function linkCodeToGrant(code: string, grantId: string): Promise<void> {
  await getDb()
    .update(schema.assistantAuthCode)
    .set({ grantId })
    .where(eq(schema.assistantAuthCode.codeHash, hashSecret(code)));
}
