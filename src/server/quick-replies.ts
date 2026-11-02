import { asc, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { apiError } from "@/lib/api";
import {
  MAX_QUICK_REPLIES,
  type QuickReplyDto,
  type QuickReplyInput,
} from "@/lib/quick-replies";

/**
 * Respuestas rápidas de la empresa (047). Las reglas puras viven en
 * `src/lib/quick-replies.ts`; acá solo la lectura y escritura scoped.
 */

export type QuickReplyRow = typeof schema.quickReply.$inferSelect;

export type QuickReplyWriteResult =
  | { ok: true; reply: QuickReplyRow }
  | { ok: false; reason: "duplicate" | "limit" | "not_found" };

export async function listQuickReplies(organizationId: string): Promise<QuickReplyRow[]> {
  return getDb()
    .select()
    .from(schema.quickReply)
    .where(scoped(schema.quickReply.organizationId, organizationId))
    .orderBy(asc(schema.quickReply.shortcut));
}

/** Postgres 23505: el atajo ya existe en la empresa (índice único). */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export async function createQuickReply(
  organizationId: string,
  userId: string,
  input: QuickReplyInput
): Promise<QuickReplyWriteResult> {
  const db = getDb();
  const [total] = await db
    .select({ n: count() })
    .from(schema.quickReply)
    .where(scoped(schema.quickReply.organizationId, organizationId));
  if ((total?.n ?? 0) >= MAX_QUICK_REPLIES) return { ok: false, reason: "limit" };
  try {
    const [reply] = await db
      .insert(schema.quickReply)
      .values({
        id: newId("quickReply"),
        organizationId,
        shortcut: input.shortcut,
        body: input.body,
        createdByUserId: userId,
      })
      .returning();
    return reply ? { ok: true, reply } : { ok: false, reason: "not_found" };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "duplicate" };
    throw err;
  }
}

export async function updateQuickReply(
  organizationId: string,
  id: string,
  input: QuickReplyInput
): Promise<QuickReplyWriteResult> {
  try {
    const [reply] = await getDb()
      .update(schema.quickReply)
      .set({ shortcut: input.shortcut, body: input.body, updatedAt: new Date() })
      .where(scoped(schema.quickReply.organizationId, organizationId, eq(schema.quickReply.id, id)))
      .returning();
    return reply ? { ok: true, reply } : { ok: false, reason: "not_found" };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "duplicate" };
    throw err;
  }
}

export async function deleteQuickReply(organizationId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.quickReply)
    .where(scoped(schema.quickReply.organizationId, organizationId, eq(schema.quickReply.id, id)))
    .returning({ id: schema.quickReply.id });
  return rows.length > 0;
}

export function serializeQuickReply(r: QuickReplyRow): QuickReplyDto {
  return { id: r.id, shortcut: r.shortcut, body: r.body, updatedAt: r.updatedAt.toISOString() };
}

export function quickReplyError(result: Exclude<QuickReplyWriteResult, { ok: true }>): Response {
  if (result.reason === "duplicate") {
    return apiError(409, "duplicate", "Ya hay una respuesta rápida con ese atajo.");
  }
  if (result.reason === "limit") {
    return apiError(409, "limit", `Hasta ${MAX_QUICK_REPLIES} respuestas rápidas por empresa.`);
  }
  return apiError(404, "not_found", "Respuesta rápida no encontrada");
}
