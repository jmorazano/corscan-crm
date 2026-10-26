import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { SQL_ACCENT_FROM, SQL_ACCENT_TO, foldAccents } from "@/lib/assistants/format";
import { likePattern } from "@/server/campaigns/manage";
import { realConversations } from "./conversations";

/**
 * Mensajes para los asistentes (040, FR-015 y búsqueda dentro de los
 * mensajes). Nunca el binario de un adjunto: solo tipo, nombre, tamaño y lo
 * que el CRM ya transcribió o resumió.
 */

const m = schema.message;
const conv = schema.conversation;

const fromCampaignSql = sql<boolean>`exists (
  select 1 from campaign_recipient cr where cr.message_id = ${m.id}
)`;

/** Un tramo del hilo, del más nuevo hacia atrás (se devuelve en orden cronológico). */
export async function readThread(
  organizationId: string,
  conversationId: string,
  page: { before: { at: Date; id: string } | null; limit: number }
) {
  const rows = await getDb()
    .select({
      message: m,
      authorName: schema.user.name,
      fromCampaign: fromCampaignSql,
      mediaMime: schema.messageMedia.mimeType,
      mediaFileName: schema.messageMedia.fileName,
      mediaSize: schema.messageMedia.sizeBytes,
      mediaDuration: schema.messageMedia.durationMs,
    })
    .from(m)
    .leftJoin(schema.user, eq(schema.user.id, m.sentByUserId))
    .leftJoin(schema.messageMedia, eq(schema.messageMedia.messageId, m.id))
    .where(
      scoped(
        m.organizationId,
        organizationId,
        eq(m.conversationId, conversationId),
        page.before
          ? or(lt(m.createdAt, page.before.at), and(eq(m.createdAt, page.before.at), lt(m.id, page.before.id)))
          : undefined
      )
    )
    .orderBy(desc(m.createdAt), desc(m.id))
    .limit(page.limit + 1);
  const hasMore = rows.length > page.limit;
  const slice = rows.slice(0, page.limit);
  const oldest = slice[slice.length - 1]?.message ?? null;
  return { rows: slice.reverse(), hasMore, oldest };
}

/** Coincidencias de texto en mensajes de conversaciones reales, más nuevas primero. */
export async function searchMessages(
  organizationId: string,
  f: {
    /** Vacío = sin filtro de texto (solo con `hasAttachment` o `types`). */
    text: string;
    hasAttachment?: boolean;
    types?: string[];
    from: Date;
    to: Date;
    channel?: "whatsapp" | "instagram";
    direction?: "in" | "out";
  },
  page: { cursor: { at: Date; id: string } | null; limit: number }
) {
  const rows = await getDb()
    .select({
      message: m,
      contactId: schema.contact.id,
      contactName: schema.contact.name,
      fromCampaign: fromCampaignSql,
      mediaMime: schema.messageMedia.mimeType,
      mediaFileName: schema.messageMedia.fileName,
    })
    .from(m)
    .innerJoin(conv, eq(conv.id, m.conversationId))
    .innerJoin(schema.contact, eq(schema.contact.id, conv.contactId))
    .leftJoin(schema.messageMedia, eq(schema.messageMedia.messageId, m.id))
    .where(
      and(
        scoped(m.organizationId, organizationId),
        realConversations(organizationId),
        // Sin distinguir tildes ni mayúsculas: «cuanto» encuentra «cuánto».
        f.text
          ? sql`translate(${m.text}, ${SQL_ACCENT_FROM}, ${SQL_ACCENT_TO}) ilike ${likePattern(foldAccents(f.text))}`
          : undefined,
        f.hasAttachment ? sql`(${schema.messageMedia.id} is not null or ${m.mediaState} is not null)` : undefined,
        f.types && f.types.length > 0 ? inArray(m.type, f.types) : undefined,
        gte(m.createdAt, f.from),
        lt(m.createdAt, f.to),
        f.channel ? eq(conv.kind, f.channel) : undefined,
        f.direction ? eq(m.direction, f.direction) : undefined,
        page.cursor
          ? or(lt(m.createdAt, page.cursor.at), and(eq(m.createdAt, page.cursor.at), lt(m.id, page.cursor.id)))
          : undefined
      )
    )
    .orderBy(desc(m.createdAt), desc(m.id))
    .limit(page.limit + 1);
  return { rows: rows.slice(0, page.limit), hasMore: rows.length > page.limit };
}
