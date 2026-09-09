import { and, count, desc, eq, gt, ilike, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isWindowOpen, windowRemainingMs } from "@/server/inbox/window";
import { sanitizeTags, type TagMode } from "@/lib/tags";
import { tagsWhere } from "@/server/tags";
import {
  DEFAULT_PAGE_SIZE,
  encodeCursor,
  type Cursor,
} from "@/lib/pagination";

export type ConversationDto = {
  id: string;
  contact: {
    id: string;
    name: string;
    phone: string;
    /** 011: BAJA/STOP registrado — la bandeja lo señaliza. */
    optedOut: boolean;
  };
  stageName: string | null;
  aiEnabled: boolean;
  handoffAt: string | null;
  handoffReason: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  windowOpen: boolean;
  windowRemainingMs: number;
  preview: string | null;
  /** Etiquetas de triage de la conversación (006). */
  tags: string[];
};

export type ListConversationsOptions = {
  since?: Date;
  tags?: readonly string[];
  mode?: TagMode;
  /** Búsqueda por nombre, teléfono, etiqueta o último mensaje (006). */
  q?: string;
  unreadOnly?: boolean;
  /** Página por cursor keyset (006): tamaño y cursor del último elemento. */
  limit?: number;
  cursor?: Cursor | null;
  /** Enlace directo: solo la conversación de este contacto. */
  contactId?: string;
};

export type ConversationPage = {
  conversations: ConversationDto[];
  /** Total que cumple filtros (tags + q), sin la restricción de no leídas. */
  total: number;
  /** Conversaciones con mensajes sin leer (tags + q). */
  unreadTotal: number;
  /** Suma de mensajes sin leer (tags + q): el badge del menú lateral. */
  unreadMessages: number;
  /** Cursor para la página siguiente; null si no hay más. */
  nextCursor: string | null;
};

/** Último mensaje de la conversación (texto o tipo de media). */
const previewSql = sql<string | null>`(
  select coalesce(m.text, m.type)
  from message m
  where m.conversation_id = ${schema.conversation.id}
  order by m.created_at desc
  limit 1
)`;
const stageSql = sql<string | null>`(
  select s.name from lead l
  join pipeline_stage s on s.id = l.stage_id
  where l.contact_id = ${schema.contact.id}
  limit 1
)`;
/** Clave de orden de la bandeja: fecha del último mensaje (o creación). */
const sortKeySql = sql`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`;

function conversationSearchWhere(q: string | undefined): SQL | undefined {
  const term = q?.trim();
  if (!term) return undefined;
  const like = `%${term}%`;
  return or(
    ilike(schema.contact.name, like),
    ilike(schema.contact.phone, like),
    sql`exists (select 1 from unnest(${schema.conversation.tags}) t where t ilike ${like})`,
    sql`${previewSql} ilike ${like}`
  );
}

/**
 * Página de la bandeja (006): filtros en SQL (tags, búsqueda, no leídas),
 * keyset por (clave de orden, id) para que la lista viva no se corra, y
 * totales para los contadores de la UI.
 */
export async function listConversationsPage(
  organizationId: string,
  options: ListConversationsOptions = {}
): Promise<ConversationPage> {
  const {
    since,
    tags = [],
    mode = "any",
    q,
    unreadOnly = false,
    limit = DEFAULT_PAGE_SIZE,
    cursor = null,
    contactId,
  } = options;
  const db = getDb();

  const baseWhere = scoped(
    schema.conversation.organizationId,
    organizationId,
    eq(schema.conversation.isTest, false),
    since ? gt(schema.conversation.updatedAt, since) : undefined,
    tagsWhere(schema.conversation.tags, tags, mode),
    conversationSearchWhere(q),
    contactId ? eq(schema.conversation.contactId, contactId) : undefined
  );
  const unreadWhere = gt(schema.conversation.unreadCount, 0);
  const pageWhere = and(
    baseWhere,
    unreadOnly ? unreadWhere : undefined,
    cursor
      ? sql`(${sortKeySql}, ${schema.conversation.id}) < (${cursor.ts.toISOString()}::timestamp, ${cursor.id})`
      : undefined
  );

  const [rows, aggRows] = await Promise.all([
    db
      .select({
        conversation: schema.conversation,
        contact: schema.contact,
        preview: previewSql,
        stageName: stageSql,
      })
      .from(schema.conversation)
      .innerJoin(
        schema.contact,
        eq(schema.conversation.contactId, schema.contact.id)
      )
      .where(pageWhere)
      .orderBy(desc(sortKeySql), desc(schema.conversation.id))
      .limit(limit + 1),
    // Un solo agregado para los tres contadores (total, con no leídos, suma
    // de no leídos) sobre el mismo WHERE base.
    db
      .select({
        total: count(),
        unreadTotal: sql<number>`count(*) filter (where ${unreadWhere})`,
        unreadMessages: sql<number>`coalesce(sum(${schema.conversation.unreadCount}), 0)`,
      })
      .from(schema.conversation)
      .innerJoin(
        schema.contact,
        eq(schema.conversation.contactId, schema.contact.id)
      )
      .where(baseWhere),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    conversations: page.map((r) =>
      serializeConversation(r.conversation, r.contact, r.preview, r.stageName)
    ),
    total: Number(aggRows[0]?.total ?? 0),
    unreadTotal: Number(aggRows[0]?.unreadTotal ?? 0),
    unreadMessages: Number(aggRows[0]?.unreadMessages ?? 0),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            ts: last.conversation.lastMessageAt ?? last.conversation.createdAt,
            id: last.conversation.id,
          })
        : null,
  };
}

/** Lista completa (sin paginar): uso interno y compatibilidad. */
export async function listConversations(
  organizationId: string,
  options: Omit<ListConversationsOptions, "limit" | "cursor"> = {}
): Promise<ConversationDto[]> {
  const page = await listConversationsPage(organizationId, {
    ...options,
    limit: 10_000,
  });
  return page.conversations;
}

export async function getConversation(
  organizationId: string,
  conversationId: string
) {
  const db = getDb();
  const rows = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listMessages(
  organizationId: string,
  conversationId: string,
  since?: Date
) {
  const db = getDb();
  return db
    .select()
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId),
        since ? gt(schema.message.createdAt, since) : undefined
      )
    )
    .orderBy(schema.message.createdAt);
}

export function serializeConversation(
  c: typeof schema.conversation.$inferSelect,
  contact: typeof schema.contact.$inferSelect,
  preview: string | null = null,
  stageName: string | null = null
): ConversationDto {
  return {
    id: c.id,
    contact: {
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      optedOut: contact.optedOutAt !== null,
    },
    stageName,
    aiEnabled: c.aiEnabled,
    handoffAt: c.handoffAt?.toISOString() ?? null,
    handoffReason: c.handoffReason,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    unreadCount: c.unreadCount,
    windowOpen: isWindowOpen(c.lastInboundAt),
    windowRemainingMs: windowRemainingMs(c.lastInboundAt),
    preview,
    tags: c.tags ?? [],
  };
}

export async function updateConversation(
  organizationId: string,
  conversationId: string,
  patch: {
    aiEnabled?: boolean;
    reactivate?: boolean;
    markRead?: boolean;
    tags?: string[];
  }
) {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.aiEnabled !== undefined) set.aiEnabled = patch.aiEnabled;
  if (patch.tags !== undefined) set.tags = sanitizeTags(patch.tags);
  if (patch.reactivate) {
    set.handoffAt = null;
    set.handoffReason = null;
    set.aiEnabled = patch.aiEnabled ?? true;
  }
  if (patch.markRead) set.unreadCount = 0;

  const updated = await db
    .update(schema.conversation)
    .set(set)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId)
      )
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Borra una conversación (los mensajes caen por cascada; los casos del
 * Laboratorio quedan con conversation_id en null). Devuelve false si no
 * existe en la organización.
 */
export async function deleteConversation(
  organizationId: string,
  conversationId: string
): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId)
      )
    )
    .returning({ id: schema.conversation.id });
  return deleted.length > 0;
}
