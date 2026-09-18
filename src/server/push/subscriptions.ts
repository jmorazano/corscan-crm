import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { PushMode } from "./payload";

export type PushSubscriptionRow = typeof schema.pushSubscription.$inferSelect;

export type SubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  mode?: PushMode;
  userAgent?: string | null;
};

/**
 * Alta idempotente por `endpoint` (013, FR-003): re-activar en otra
 * empresa o con otro usuario re-liga la fila; el modo solo cambia si viene.
 */
export async function upsertSubscription(
  organizationId: string,
  userId: string,
  input: SubscriptionInput
): Promise<PushSubscriptionRow> {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .insert(schema.pushSubscription)
    .values({
      id: `ps_${nanoid(16)}`,
      organizationId,
      userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      mode: input.mode ?? "all",
      userAgent: input.userAgent ?? null,
      lastUsedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.pushSubscription.endpoint,
      set: {
        organizationId,
        userId,
        p256dh: input.p256dh,
        auth: input.auth,
        ...(input.mode ? { mode: input.mode } : {}),
        userAgent: input.userAgent ?? null,
        lastUsedAt: now,
      },
    })
    .returning();
  if (!row) throw new Error("No se pudo guardar la suscripción");
  return row;
}

export async function updateSubscriptionMode(
  organizationId: string,
  userId: string,
  endpoint: string,
  mode: PushMode
): Promise<PushSubscriptionRow | null> {
  const [row] = await getDb()
    .update(schema.pushSubscription)
    .set({ mode })
    .where(
      scoped(
        schema.pushSubscription.organizationId,
        organizationId,
        and(
          eq(schema.pushSubscription.userId, userId),
          eq(schema.pushSubscription.endpoint, endpoint)
        )
      )
    )
    .returning();
  return row ?? null;
}

export async function removeSubscription(
  organizationId: string,
  userId: string,
  endpoint: string
): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.pushSubscription)
    .where(
      scoped(
        schema.pushSubscription.organizationId,
        organizationId,
        and(
          eq(schema.pushSubscription.userId, userId),
          eq(schema.pushSubscription.endpoint, endpoint)
        )
      )
    )
    .returning({ id: schema.pushSubscription.id });
  return rows.length > 0;
}

export async function listSubscriptions(
  organizationId: string,
  filter: { userId?: string } = {}
): Promise<PushSubscriptionRow[]> {
  return getDb()
    .select()
    .from(schema.pushSubscription)
    .where(
      scoped(
        schema.pushSubscription.organizationId,
        organizationId,
        filter.userId ? eq(schema.pushSubscription.userId, filter.userId) : undefined
      )
    );
}

/** Poda (FR-008): el push service respondió 404/410 para ese endpoint. */
export async function deleteByEndpoints(
  organizationId: string,
  endpoints: string[]
): Promise<number> {
  if (endpoints.length === 0) return 0;
  const rows = await getDb()
    .delete(schema.pushSubscription)
    .where(
      scoped(
        schema.pushSubscription.organizationId,
        organizationId,
        inArray(schema.pushSubscription.endpoint, endpoints)
      )
    )
    .returning({ id: schema.pushSubscription.id });
  return rows.length;
}

export async function touchSubscriptions(
  organizationId: string,
  endpoints: string[]
): Promise<void> {
  if (endpoints.length === 0) return;
  await getDb()
    .update(schema.pushSubscription)
    .set({ lastUsedAt: new Date() })
    .where(
      scoped(
        schema.pushSubscription.organizationId,
        organizationId,
        inArray(schema.pushSubscription.endpoint, endpoints)
      )
    );
}

/** DTO para el cliente: sin claves (`p256dh`/`auth` no hacen falta afuera). */
export function serializeSubscription(row: PushSubscriptionRow) {
  return {
    endpoint: row.endpoint,
    mode: row.mode,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}
