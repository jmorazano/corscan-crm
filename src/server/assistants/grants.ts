import { and, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { IDLE_EXPIRY_DAYS } from "@/lib/oauth-server/tokens";
import { pruneOrphanClients } from "./clients";
import { purgeAccessLog } from "./log";

/**
 * Conexiones de los asistentes (040, FR-023/FR-024). Estados monotónicos con
 * guard en el WHERE: active → revoked | expired, nunca vuelve.
 */

export type GrantRevokedReason = NonNullable<
  (typeof schema.assistantGrant.$inferSelect)["revokedReason"]
>;

export async function createGrant(input: {
  userId: string;
  clientId: string;
  clientLabel: string;
  organizationIds: readonly string[];
  resource: string;
}): Promise<string> {
  const id = newId("assistantGrant");
  await getDb().transaction(async (tx) => {
    await tx.insert(schema.assistantGrant).values({
      id,
      userId: input.userId,
      clientId: input.clientId,
      clientLabel: input.clientLabel,
      resource: input.resource,
    });
    await tx
      .insert(schema.assistantGrantOrg)
      .values([...new Set(input.organizationIds)].map((organizationId) => ({ organizationId, grantId: id })));
  });
  return id;
}

/** true si esta llamada la revocó (false si ya no estaba activa). */
export async function revokeGrant(
  grantId: string,
  reason: GrantRevokedReason,
  byUserId: string | null,
  now: Date = new Date()
): Promise<boolean> {
  const rows = await getDb()
    .update(schema.assistantGrant)
    .set({ status: "revoked", revokedReason: reason, revokedByUserId: byUserId, revokedAt: now })
    .where(and(eq(schema.assistantGrant.id, grantId), eq(schema.assistantGrant.status, "active")))
    .returning({ id: schema.assistantGrant.id });
  return rows.length > 0;
}

/** Cambio o restablecimiento de contraseña: se cortan TODAS (D14). */
export async function revokeAllGrantsForUser(
  userId: string,
  reason: GrantRevokedReason = "password_change",
  now: Date = new Date()
): Promise<number> {
  const rows = await getDb()
    .update(schema.assistantGrant)
    .set({ status: "revoked", revokedReason: reason, revokedByUserId: userId, revokedAt: now })
    .where(and(eq(schema.assistantGrant.userId, userId), eq(schema.assistantGrant.status, "active")))
    .returning({ id: schema.assistantGrant.id });
  return rows.length;
}

export async function expireGrant(grantId: string, now: Date = new Date()): Promise<void> {
  await getDb()
    .update(schema.assistantGrant)
    .set({ status: "expired", revokedReason: "idle", revokedAt: now })
    .where(and(eq(schema.assistantGrant.id, grantId), eq(schema.assistantGrant.status, "active")));
}

export type ConnectionDto = {
  id: string;
  clientLabel: string;
  clientName: string | null;
  user: { id: string; name: string; email: string };
  otherWorkspaces: number;
  status: "active" | "revoked" | "expired";
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedReason: GrantRevokedReason | null;
};

/** Conexiones con acceso a ESTA empresa (las cerradas, solo de 30 días). */
export async function listConnectionsForOrganization(
  organizationId: string,
  now: Date = new Date()
): Promise<ConnectionDto[]> {
  const db = getDb();
  const recent = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      grant: schema.assistantGrant,
      clientName: schema.assistantClient.clientName,
      userName: schema.user.name,
      userEmail: schema.user.email,
    })
    .from(schema.assistantGrantOrg)
    .innerJoin(schema.assistantGrant, eq(schema.assistantGrant.id, schema.assistantGrantOrg.grantId))
    .innerJoin(schema.assistantClient, eq(schema.assistantClient.id, schema.assistantGrant.clientId))
    .innerJoin(schema.user, eq(schema.user.id, schema.assistantGrant.userId))
    .where(
      and(
        eq(schema.assistantGrantOrg.organizationId, organizationId),
        or(eq(schema.assistantGrant.status, "active"), gt(schema.assistantGrant.revokedAt, recent))
      )
    )
    .orderBy(desc(schema.assistantGrant.createdAt));
  if (rows.length === 0) return [];
  const others = await db
    .select({ grantId: schema.assistantGrantOrg.grantId })
    .from(schema.assistantGrantOrg)
    .where(inArray(schema.assistantGrantOrg.grantId, rows.map((r) => r.grant.id)));
  const countByGrant = new Map<string, number>();
  for (const o of others) countByGrant.set(o.grantId, (countByGrant.get(o.grantId) ?? 0) + 1);
  return rows.map(({ grant, clientName, userName, userEmail }) => ({
    id: grant.id,
    clientLabel: grant.clientLabel,
    clientName,
    user: { id: grant.userId, name: userName, email: userEmail },
    otherWorkspaces: Math.max(0, (countByGrant.get(grant.id) ?? 1) - 1),
    status: grant.status,
    createdAt: grant.createdAt.toISOString(),
    lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    revokedReason: grant.revokedReason,
  }));
}

/** ¿La conexión incluye esta empresa? (para que su propietario la revoque). */
export async function grantIncludesOrganization(grantId: string, organizationId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ grantId: schema.assistantGrantOrg.grantId })
    .from(schema.assistantGrantOrg)
    .where(
      and(
        eq(schema.assistantGrantOrg.grantId, grantId),
        eq(schema.assistantGrantOrg.organizationId, organizationId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function grantOwnerId(grantId: string): Promise<string | null> {
  const rows = await getDb()
    .select({ userId: schema.assistantGrant.userId })
    .from(schema.assistantGrant)
    .where(eq(schema.assistantGrant.id, grantId))
    .limit(1);
  return rows[0]?.userId ?? null;
}

/**
 * Barrido diario (research D13): clientes huérfanos, códigos y tokens
 * vencidos, conexiones inactivas y registro viejo. Cada paso es
 * independiente: si uno falla, los demás igual corren.
 */
export async function sweepAssistants(now: Date = new Date()): Promise<void> {
  const db = getDb();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const idleCutoff = new Date(now.getTime() - IDLE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const steps: [string, () => Promise<unknown>][] = [
    ["clientes", () => pruneOrphanClients(now)],
    ["códigos", () => db.delete(schema.assistantAuthCode).where(lt(schema.assistantAuthCode.expiresAt, dayAgo))],
    ["tokens", () => db.delete(schema.assistantToken).where(lt(schema.assistantToken.expiresAt, dayAgo))],
    [
      "inactivas",
      () =>
        db
          .update(schema.assistantGrant)
          .set({ status: "expired", revokedReason: "idle", revokedAt: now })
          .where(
            and(
              eq(schema.assistantGrant.status, "active"),
              or(
                lt(schema.assistantGrant.lastUsedAt, idleCutoff),
                and(isNull(schema.assistantGrant.lastUsedAt), lt(schema.assistantGrant.createdAt, idleCutoff))
              )
            )
          ),
    ],
    ["registro", () => purgeAccessLog(now)],
  ];
  for (const [label, step] of steps) {
    try {
      await step();
    } catch (err) {
      console.error(`[assistants] barrido (${label}) falló:`, (err as Error)?.message ?? err);
    }
  }
}

declare global {
  var __voceroAssistantsSweep: ReturnType<typeof setInterval> | undefined;
}

const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

/** Barrido diario en proceso (como el ticker de Instagram); idempotente. */
export function startAssistantsSweepTicker(): void {
  if (globalThis.__voceroAssistantsSweep) return;
  const run = () => void sweepAssistants().catch(() => undefined);
  globalThis.__voceroAssistantsSweep = setInterval(run, SWEEP_EVERY_MS);
  globalThis.__voceroAssistantsSweep.unref?.();
  // El primero, un rato después del arranque (no compite con las migraciones).
  setTimeout(run, 60 * 1000).unref?.();
}
