import { eq, isNull, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/**
 * 048: «última vez que abrió el CRM». La toca el SSE (`/api/events`), que la
 * app abre en cada pantalla mientras está en primer plano. Como mucho una
 * escritura cada 5 minutos por persona y empresa: un freno en memoria y
 * otro en el WHERE (varias réplicas o pestañas). Solo el último momento,
 * sin historial. Nunca lanza.
 */
const THROTTLE_MS = 5 * 60_000;
const lastTouch = new Map<string, number>();

export function touchLastSeen(organizationId: string, userId: string, now: Date = new Date()): void {
  const key = `${organizationId}:${userId}`;
  const prev = lastTouch.get(key);
  if (prev !== undefined && now.getTime() - prev < THROTTLE_MS) return;
  lastTouch.set(key, now.getTime());
  void getDb()
    .update(schema.member)
    .set({ lastSeenAt: now })
    .where(
      scoped(
        schema.member.organizationId,
        organizationId,
        eq(schema.member.userId, userId),
        or(isNull(schema.member.lastSeenAt), lt(schema.member.lastSeenAt, new Date(now.getTime() - THROTTLE_MS)))
      )
    )
    .catch((err) => {
      lastTouch.delete(key);
      console.error("[atención] última vez:", err instanceof Error ? err.message : err);
    });
}

/** Solo tests: olvidar el freno en memoria. */
export function resetLastSeenThrottle(): void {
  lastTouch.clear();
}

