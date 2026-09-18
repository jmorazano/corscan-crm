import { and, count, desc, eq, isNull, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { apiKeyPrefix, generateApiKey, hashApiKey } from "@/lib/api-keys";

/**
 * Claves de API por empresa (014, FR-001/FR-002). La clave completa existe
 * UNA vez: en la respuesta del alta. Acá solo viven hash + prefijo.
 */

export type ApiKeyRow = typeof schema.apiKey.$inferSelect;

/** Claves activas por empresa (freno sensato; no es un plan). */
export const MAX_ACTIVE_KEYS = 20;

export class ApiKeyError extends Error {
  code: "limit" | "not_found";
  constructor(code: ApiKeyError["code"], message: string) {
    super(message);
    this.name = "ApiKeyError";
    this.code = code;
  }
}

export function serializeApiKey(row: ApiKeyRow) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.keyPrefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export async function listApiKeys(organizationId: string): Promise<ApiKeyRow[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.apiKey)
    .where(scoped(schema.apiKey.organizationId, organizationId))
    .orderBy(desc(schema.apiKey.createdAt));
}

/** Alta: devuelve la fila y el SECRETO (única vez que existe en claro). */
export async function createApiKey(input: {
  organizationId: string;
  name: string;
  createdBy: string | null;
}): Promise<{ row: ApiKeyRow; secret: string }> {
  const db = getDb();
  const active = await db
    .select({ n: count() })
    .from(schema.apiKey)
    .where(
      scoped(
        schema.apiKey.organizationId,
        input.organizationId,
        isNull(schema.apiKey.revokedAt)
      )
    );
  if ((active[0]?.n ?? 0) >= MAX_ACTIVE_KEYS) {
    throw new ApiKeyError(
      "limit",
      `Máximo ${MAX_ACTIVE_KEYS} claves activas por empresa: revocá alguna que no uses`
    );
  }

  const secret = generateApiKey();
  const inserted = await db
    .insert(schema.apiKey)
    .values({
      id: newId("apiKey"),
      organizationId: input.organizationId,
      name: input.name,
      keyHash: hashApiKey(secret),
      keyPrefix: apiKeyPrefix(secret),
      createdBy: input.createdBy,
    })
    .returning();
  return { row: inserted[0]!, secret };
}

/** Revocación (soft): idempotente — revocar dos veces deja el mismo estado. */
export async function revokeApiKey(
  organizationId: string,
  id: string
): Promise<ApiKeyRow> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.apiKey)
    .where(scoped(schema.apiKey.organizationId, organizationId, eq(schema.apiKey.id, id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new ApiKeyError("not_found", "Clave no encontrada");
  if (row.revokedAt) return row;
  const updated = await db
    .update(schema.apiKey)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKey.id, id), isNull(schema.apiKey.revokedAt)))
    .returning();
  return updated[0] ?? { ...row, revokedAt: new Date() };
}

export type VerifiedApiKey = {
  id: string;
  organizationId: string;
  name: string;
  lastUsedAt: Date | null;
};

/**
 * Resuelve una clave completa a su empresa. Búsqueda por hash (índice
 * único); revocada = inexistente. Único punto donde el secreto toca la BD.
 */
export async function verifyApiKey(secret: string): Promise<VerifiedApiKey | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.apiKey.id,
      organizationId: schema.apiKey.organizationId,
      name: schema.apiKey.name,
      lastUsedAt: schema.apiKey.lastUsedAt,
    })
    .from(schema.apiKey)
    .where(
      and(eq(schema.apiKey.keyHash, hashApiKey(secret)), isNull(schema.apiKey.revokedAt))
    )
    .limit(1);
  return rows[0] ?? null;
}

const TOUCH_INTERVAL_MS = 60_000;

/** `last_used_at` a lo sumo una vez por minuto (research D7). */
export async function touchApiKey(id: string, lastUsedAt: Date | null): Promise<void> {
  const now = Date.now();
  if (lastUsedAt && now - lastUsedAt.getTime() < TOUCH_INTERVAL_MS) return;
  const db = getDb();
  await db
    .update(schema.apiKey)
    .set({ lastUsedAt: new Date(now) })
    .where(
      and(
        eq(schema.apiKey.id, id),
        or(
          isNull(schema.apiKey.lastUsedAt),
          lt(schema.apiKey.lastUsedAt, new Date(now - TOUCH_INTERVAL_MS))
        )
      )
    );
}
