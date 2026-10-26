import { and, desc, eq, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * Registro de consultas de los asistentes, por empresa (040, FR-025). Se
 * guarda QUÉ se consultó, nunca lo que se devolvió. Escribe en segundo plano:
 * un fallo acá jamás tumba la consulta.
 */

export type AccessOutcome = "ok" | "denied" | "error";
export type AccessReason =
  | "not_authorized"
  | "disabled"
  | "not_owner"
  | "invalid_args"
  | "not_found"
  | "rate_limited"
  | "internal"
  /** 041: una enseñanza en la que las protecciones rechazaron todo. */
  | "rejected";

export const LOG_RETENTION_DAYS = 90;
const MAX_SUMMARY_CHARS = 200;

export function clampSummary(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > MAX_SUMMARY_CHARS ? `${one.slice(0, MAX_SUMMARY_CHARS - 1)}…` : one;
}

export function logAssistantCall(entry: {
  organizationIds: readonly string[];
  grantId: string;
  userId: string;
  clientLabel: string;
  tool: string;
  summary: string;
  outcome: AccessOutcome;
  reason?: AccessReason | null;
}): void {
  if (entry.organizationIds.length === 0) return;
  const now = new Date();
  void getDb()
    .insert(schema.assistantAccessLog)
    .values(
      entry.organizationIds.map((organizationId) => ({
        id: newId("assistantAccessLog"),
        organizationId,
        grantId: entry.grantId,
        userId: entry.userId,
        clientLabel: entry.clientLabel,
        tool: entry.tool,
        summary: clampSummary(entry.summary),
        outcome: entry.outcome,
        reason: entry.reason ?? null,
        createdAt: now,
      }))
    )
    .catch((err: unknown) => {
      console.error("[assistants] no se pudo registrar la consulta:", (err as Error)?.message);
    });
}

export type AccessLogEntryDto = {
  id: string;
  at: string;
  clientLabel: string;
  user: string | null;
  tool: string;
  summary: string;
  outcome: AccessOutcome;
  reason: AccessReason | null;
};

/** Página del registro, más nuevos primero; cursor = `<iso>|<id>`. */
export async function listAccessLog(
  organizationId: string,
  opts: { cursor?: string | null; limit?: number } = {}
): Promise<{ entries: AccessLogEntryDto[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const t = schema.assistantAccessLog;
  let cursorWhere;
  if (opts.cursor) {
    const [iso, id] = opts.cursor.split("|");
    const ts = iso ? new Date(iso) : null;
    if (ts && !Number.isNaN(ts.getTime()) && id) {
      cursorWhere = or(lt(t.createdAt, ts), and(eq(t.createdAt, ts), lt(t.id, id)));
    }
  }
  const rows = await getDb()
    .select({ log: t, userName: schema.user.name })
    .from(t)
    .leftJoin(schema.user, eq(schema.user.id, t.userId))
    .where(scoped(t.organizationId, organizationId, cursorWhere))
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    entries: page.map(({ log, userName }) => ({
      id: log.id,
      at: log.createdAt.toISOString(),
      clientLabel: log.clientLabel,
      user: userName,
      tool: log.tool,
      summary: log.summary,
      outcome: log.outcome,
      reason: log.reason,
    })),
    nextCursor: rows.length > limit && last ? `${last.log.createdAt.toISOString()}|${last.log.id}` : null,
  };
}

/** Purga del barrido diario. */
export async function purgeAccessLog(now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await getDb().delete(schema.assistantAccessLog).where(lt(schema.assistantAccessLog.createdAt, cutoff));
}
