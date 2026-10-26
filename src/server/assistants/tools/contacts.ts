import { and, count, desc, eq, ilike, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { THIRD_PARTY_NOTICE, isoInZone } from "@/lib/assistants/format";
import { likePattern } from "@/server/campaigns/manage";
import { tagsWhere } from "@/server/tags";
import {
  ToolNotFoundError,
  decodeKeyset,
  encodeKeyset,
  foreign,
  limitParam,
  resolveTimeZone,
  workspaceParam,
  type AssistantTool,
} from "./common";

/**
 * Contactos (040, contracts/mcp-tools.md §9–10). Sin el contacto sintético
 * del Entrenador ni los del Laboratorio (`is_test`).
 */

const ct = schema.contact;

/**
 * Etapa del lead del contacto. Calificada a mano: en un SELECT de una sola
 * tabla drizzle no antepone el nombre de la tabla y `"id"` quedaría ambiguo
 * dentro del subquery.
 */
const contactStageSql = sql<string | null>`(
  select s.name from lead l
  join pipeline_stage s on s.id = l.stage_id
  where l.contact_id = "contact"."id"
  limit 1
)`;

function contactOut(c: typeof ct.$inferSelect, stage: string | null, timeZone: string) {
  return {
    id: c.id,
    name: foreign(c.name, 80),
    phone: c.channel === "instagram" ? null : c.phone,
    instagram_username: c.igUsername ? `@${c.igUsername}` : null,
    email: foreign(c.email, 120),
    contact_phone: c.contactPhone,
    channel: c.channel ?? "whatsapp",
    tags: c.tags ?? [],
    opted_out: c.optedOutAt !== null,
    stage,
    created_at: isoInZone(c.createdAt, timeZone),
  };
}

const searchContactsTool: AssistantTool = {
  name: "search_contacts",
  title: "Buscar contactos",
  description:
    "Busca contactos por nombre, teléfono, @usuario de Instagram o email, y por etiquetas, canal o baja (opt-out). Devuelve su ficha corta con la etapa del lead; para el detalle y sus conversaciones usá get_contact.",
  input: z.object({
    workspace: workspaceParam,
    q: z.string().max(120).optional(),
    tags: z.array(z.string().max(60)).max(10).optional(),
    tags_mode: z.enum(["any", "all"]).optional(),
    channel: z.enum(["whatsapp", "instagram"]).optional(),
    opted_out: z.boolean().optional().describe("true: solo los dados de baja; false: solo los que no."),
    include_archived: z.boolean().optional(),
    timezone: z.string().max(64).optional(),
    cursor: z.string().max(200).optional(),
    limit: limitParam(25, 50),
  }),
  needsWorkspace: true,
  describe: (args) => (args.q ? `Buscó contactos «${String(args.q).slice(0, 40)}»` : "Buscó contactos"),
  async run({ workspace }, args) {
    const orgId = workspace!.id;
    const timeZone = resolveTimeZone(args.timezone);
    const q = typeof args.q === "string" ? args.q.trim() : "";
    const like = likePattern(q.replace(/^@/, ""));
    const where = scoped(
      ct.organizationId,
      orgId,
      eq(ct.isTest, false),
      q ? or(ilike(ct.name, like), ilike(ct.phone, like), ilike(ct.igUsername, like), ilike(ct.email, like)) : undefined,
      args.include_archived === true ? undefined : isNull(ct.archivedAt),
      Array.isArray(args.tags) && args.tags.length > 0
        ? tagsWhere(ct.tags, args.tags as string[], (args.tags_mode as "any" | "all" | undefined) ?? "any")
        : undefined,
      args.channel ? eq(ct.channel, args.channel as "whatsapp" | "instagram") : undefined,
      args.opted_out === true ? isNotNull(ct.optedOutAt) : args.opted_out === false ? isNull(ct.optedOutAt) : undefined
    );
    const cursor = decodeKeyset(args.cursor);
    const limit = (args.limit as number | undefined) ?? 25;
    const db = getDb();
    const [rows, totals] = await Promise.all([
      db
        .select({ contact: ct, stage: contactStageSql })
        .from(ct)
        .where(and(where, cursor ? or(lt(ct.createdAt, cursor.at), and(eq(ct.createdAt, cursor.at), lt(ct.id, cursor.id))) : undefined))
        .orderBy(desc(ct.createdAt), desc(ct.id))
        .limit(limit + 1),
      db.select({ n: count() }).from(ct).where(where),
    ]);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      data: {
        workspace: { id: orgId, name: workspace!.name },
        total_matching: totals[0]?.n ?? 0,
        contacts: page.map((r) => contactOut(r.contact, r.stage, timeZone)),
        next_cursor: rows.length > limit && last ? encodeKeyset(last.contact.createdAt, last.contact.id) : null,
        truncated: rows.length > limit,
        aviso_contenido_de_terceros: THIRD_PARTY_NOTICE,
      },
    };
  },
};

const getContactTool: AssistantTool = {
  name: "get_contact",
  title: "Ficha de un contacto",
  description:
    "Ficha completa de un contacto: datos, etiquetas, notas del equipo, origen, consentimiento y baja, etapa del lead, sus conversaciones y las campañas que recibió (y si respondió).",
  input: z.object({
    workspace: workspaceParam,
    contact_id: z.string().max(64),
    timezone: z.string().max(64).optional(),
  }),
  needsWorkspace: true,
  describe: () => "Abrió la ficha de un contacto",
  async run({ workspace }, args) {
    const orgId = workspace!.id;
    const timeZone = resolveTimeZone(args.timezone);
    const db = getDb();
    const found = await db
      .select({ contact: ct, stage: contactStageSql })
      .from(ct)
      .where(scoped(ct.organizationId, orgId, eq(ct.id, String(args.contact_id)), eq(ct.isTest, false)))
      .limit(1);
    const row = found[0];
    if (!row) throw new ToolNotFoundError("No encontré ese contacto en esta empresa.");
    const [conversations, campaigns] = await Promise.all([
      db
        .select({
          id: schema.conversation.id,
          kind: schema.conversation.kind,
          lastMessageAt: schema.conversation.lastMessageAt,
          origin: sql<string | null>`${schema.conversation.igOrigin}->>'label'`,
        })
        .from(schema.conversation)
        .where(
          scoped(
            schema.conversation.organizationId,
            orgId,
            eq(schema.conversation.contactId, row.contact.id),
            eq(schema.conversation.isTest, false)
          )
        )
        .orderBy(desc(schema.conversation.lastMessageAt))
        .limit(20),
      db
        .select({
          id: schema.campaign.id,
          name: schema.campaign.name,
          status: schema.campaignRecipient.status,
          sentAt: schema.campaignRecipient.sentAt,
          repliedAt: schema.campaignRecipient.repliedAt,
        })
        .from(schema.campaignRecipient)
        .innerJoin(schema.campaign, eq(schema.campaign.id, schema.campaignRecipient.campaignId))
        .where(
          and(
            eq(schema.campaignRecipient.organizationId, orgId),
            eq(schema.campaignRecipient.contactId, row.contact.id)
          )
        )
        .orderBy(desc(schema.campaignRecipient.sentAt))
        .limit(20),
    ]);
    const c = row.contact;
    return {
      summary: `Abrió la ficha de ${foreign(c.name, 60) ?? "un contacto"}`,
      data: {
        workspace: { id: orgId, name: workspace!.name },
        contact: {
          ...contactOut(c, row.stage, timeZone),
          notes: foreign(c.notes, 2000),
          consent_source: c.consentSource,
          opted_out_at: isoInZone(c.optedOutAt, timeZone),
          archived: c.archivedAt !== null,
        },
        conversations: conversations.map((cv) => ({
          id: cv.id,
          channel: cv.kind,
          last_message_at: isoInZone(cv.lastMessageAt, timeZone),
          origin: foreign(cv.origin, 160),
        })),
        campaigns: campaigns.map((cp) => ({
          id: cp.id,
          name: foreign(cp.name, 120),
          recipient_status: cp.status,
          sent_at: isoInZone(cp.sentAt, timeZone),
          replied_at: isoInZone(cp.repliedAt, timeZone),
        })),
        aviso_contenido_de_terceros: THIRD_PARTY_NOTICE,
      },
    };
  },
};

export const contactTools: AssistantTool[] = [searchContactsTool, getContactTool];
