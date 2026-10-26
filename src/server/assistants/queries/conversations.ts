import { and, count, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { TagMode } from "@/lib/tags";
import {
  conversationSearchWhere,
  previewSql,
  sortKeySql,
  stageSql,
} from "@/server/inbox/queries";
import { tagsWhere } from "@/server/tags";
import { ORIGIN_KIND_SQL } from "../tools/metrics";

/**
 * Búsqueda de conversaciones para los asistentes (040, FR-014). Mismos
 * predicados que la Bandeja (etiquetas, texto) más los filtros que solo
 * necesita el asistente. Siempre conversaciones REALES de WhatsApp o
 * Instagram: nunca el Laboratorio ni el Entrenador.
 */

const conv = schema.conversation;
const contact = schema.contact;

export type ConversationFilters = {
  q?: string;
  channel?: "whatsapp" | "instagram";
  tags?: string[];
  tagsMode?: TagMode;
  stageId?: string;
  origin?: string;
  unread?: boolean;
  handoff?: boolean;
  aiPaused?: boolean;
  activeFrom?: Date;
  activeTo?: Date;
};

export function realConversations(organizationId: string, ...extra: (SQL | undefined)[]): SQL {
  return scoped(
    conv.organizationId,
    organizationId,
    eq(conv.isTest, false),
    sql`${conv.kind} in ('whatsapp', 'instagram')`,
    ...extra
  );
}

function filtersWhere(f: ConversationFilters): (SQL | undefined)[] {
  return [
    f.channel ? eq(conv.kind, f.channel) : undefined,
    f.tags && f.tags.length > 0 ? tagsWhere(conv.tags, f.tags, f.tagsMode ?? "any") : undefined,
    conversationSearchWhere(f.q),
    f.stageId
      ? sql`exists (select 1 from lead l where l.contact_id = ${contact.id} and l.stage_id = ${f.stageId})`
      : undefined,
    f.origin ? sql`${ORIGIN_KIND_SQL} = ${f.origin}` : undefined,
    f.unread === true ? sql`${conv.unreadCount} > 0` : f.unread === false ? eq(conv.unreadCount, 0) : undefined,
    f.handoff === true ? isNotNull(conv.handoffAt) : f.handoff === false ? isNull(conv.handoffAt) : undefined,
    f.aiPaused === true ? eq(conv.aiEnabled, false) : f.aiPaused === false ? eq(conv.aiEnabled, true) : undefined,
    // Fechas como texto ISO con cast: un `Date` crudo dentro de `sql` revienta en postgres-js.
    f.activeFrom ? sql`${sortKeySql} >= ${f.activeFrom.toISOString()}::timestamp` : undefined,
    f.activeTo ? sql`${sortKeySql} < ${f.activeTo.toISOString()}::timestamp` : undefined,
  ];
}

export async function searchConversations(
  organizationId: string,
  f: ConversationFilters,
  page: { cursor: { at: Date; id: string } | null; limit: number }
) {
  const db = getDb();
  const where = realConversations(organizationId, ...filtersWhere(f));
  const cursorWhere = page.cursor
    ? sql`(${sortKeySql}, ${conv.id}) < (${page.cursor.at.toISOString()}::timestamp, ${page.cursor.id})`
    : undefined;
  const [rows, totals] = await Promise.all([
    db
      .select({
        conversation: conv,
        contact,
        preview: previewSql,
        stageName: stageSql,
        sortKey: sql<string>`to_char(${sortKeySql}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      })
      .from(conv)
      .innerJoin(contact, eq(conv.contactId, contact.id))
      .where(and(where, cursorWhere))
      .orderBy(desc(sortKeySql), desc(conv.id))
      .limit(page.limit + 1),
    db
      .select({ n: count() })
      .from(conv)
      .innerJoin(contact, eq(conv.contactId, contact.id))
      .where(where),
  ]);
  return { rows, total: totals[0]?.n ?? 0 };
}

/** Una conversación real de la empresa (null si no existe o es de otra). */
export async function findConversation(organizationId: string, conversationId: string) {
  const rows = await getDb()
    .select({ conversation: conv, contact, stageName: stageSql })
    .from(conv)
    .innerJoin(contact, eq(conv.contactId, contact.id))
    .where(realConversations(organizationId, eq(conv.id, conversationId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Etapa por nombre (sin distinguir mayúsculas) o id; null + la lista si no existe. */
export async function resolveStage(
  organizationId: string,
  ref: { id?: string; name?: string }
): Promise<{ id: string; name: string } | { id: null; available: string[] }> {
  const stages = await getDb()
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(schema.pipelineStage.position);
  const found = ref.id
    ? stages.find((s) => s.id === ref.id)
    : stages.find((s) => s.name.toLocaleLowerCase("es") === (ref.name ?? "").trim().toLocaleLowerCase("es"));
  return found ?? { id: null, available: stages.map((s) => s.name) };
}
