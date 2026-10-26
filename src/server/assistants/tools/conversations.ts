import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod/v4";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { eventText } from "@/lib/conversation-events";
import { addDaysToKey } from "@/lib/time";
import {
  THIRD_PARTY_NOTICE,
  attachmentKind,
  isoInZone,
  messageAuthor,
  snippetAround,
} from "@/lib/assistants/format";
import { serializeEvent } from "@/server/ai/events";
import { findConversation, resolveStage, searchConversations } from "../queries/conversations";
import { readThread, searchMessages } from "../queries/messages";
import {
  ToolInputError,
  ToolNotFoundError,
  dateParam,
  dayStartUtc,
  decodeKeyset,
  encodeKeyset,
  foreign,
  limitParam,
  resolveTimeZone,
  workspaceParam,
  type AssistantTool,
} from "./common";
import { ORIGIN_LABELS } from "./metrics";

/**
 * Conversaciones y mensajes (040, contracts/mcp-tools.md §6–8). Todo texto
 * de un tercero sale por `foreign()` y con el aviso (FR-020).
 */

type ConversationRow = typeof schema.conversation.$inferSelect;
type ContactRow = typeof schema.contact.$inferSelect;

const ORIGIN_KINDS = Object.keys(ORIGIN_LABELS) as [string, ...string[]];

function contactOut(c: ContactRow) {
  return {
    id: c.id,
    name: foreign(c.name, 80),
    phone: c.channel === "instagram" ? null : c.phone,
    instagram_username: c.igUsername ? `@${c.igUsername}` : null,
    opted_out: c.optedOutAt !== null,
  };
}

function conversationOut(
  c: ConversationRow,
  contact: ContactRow,
  stageName: string | null,
  timeZone: string,
  preview?: string | null
) {
  return {
    id: c.id,
    channel: c.kind,
    contact: contactOut(contact),
    last_message_at: isoInZone(c.lastMessageAt, timeZone),
    last_inbound_at: isoInZone(c.lastInboundAt, timeZone),
    ...(preview !== undefined ? { last_message_preview: foreign(preview, 200) } : {}),
    unread: c.unreadCount,
    tags: c.tags ?? [],
    stage: stageName,
    ai: {
      enabled: c.aiEnabled,
      handoff: c.handoffAt !== null,
      handoff_at: isoInZone(c.handoffAt, timeZone),
      handoff_reason: c.handoffReason,
    },
    origin: c.igOrigin ? foreign(c.igOrigin.label, 160) : null,
    created_at: isoInZone(c.createdAt, timeZone),
  };
}

const searchConversationsTool: AssistantTool = {
  name: "search_conversations",
  title: "Buscar conversaciones",
  description:
    "Busca conversaciones de WhatsApp e Instagram con los filtros de la Bandeja: texto (nombre, teléfono, @usuario, etiqueta o último mensaje), canal, etiquetas, etapa del lead, origen, sin leer, en atención humana, IA pausada y fecha de actividad. Devuelve una página con el último mensaje recortado; para leer un chat entero usá get_conversation. Para buscar una palabra DENTRO de los mensajes usá search_messages.",
  input: z.object({
    workspace: workspaceParam,
    q: z.string().max(120).optional().describe("Texto: nombre, teléfono, @usuario, etiqueta o último mensaje."),
    channel: z.enum(["whatsapp", "instagram"]).optional(),
    tags: z.array(z.string().max(60)).max(10).optional(),
    tags_mode: z.enum(["any", "all"]).optional().describe("any (default): alguna; all: todas."),
    stage: z.string().max(80).optional().describe("Nombre de la etapa del pipeline (o su id)."),
    origin: z.enum(ORIGIN_KINDS).optional().describe("Origen marcado en la conversación."),
    unread: z.boolean().optional(),
    handoff: z.boolean().optional().describe("true: en atención humana (derivadas por el agente)."),
    ai_paused: z.boolean().optional().describe("true: con la IA apagada en ese chat."),
    active_from: dateParam.optional().describe("Con actividad desde este día (AAAA-MM-DD)."),
    active_to: dateParam.optional().describe("Con actividad hasta este día inclusive."),
    timezone: z.string().max(64).optional(),
    cursor: z.string().max(200).optional(),
    limit: limitParam(25, 50),
  }),
  needsWorkspace: true,
  describe: (args) => (args.q ? `Buscó conversaciones «${String(args.q).slice(0, 40)}»` : "Buscó conversaciones"),
  async run({ workspace }, args) {
    const orgId = workspace!.id;
    const timeZone = resolveTimeZone(args.timezone);
    let stageId: string | undefined;
    if (typeof args.stage === "string" && args.stage.trim()) {
      const st = await resolveStage(orgId, args.stage.startsWith("stg_") ? { id: args.stage } : { name: args.stage });
      if (st.id === null) {
        throw new ToolInputError(`No existe la etapa «${args.stage.slice(0, 60)}». Etapas: ${st.available.join(", ")}.`);
      }
      stageId = st.id;
    }
    const limit = (args.limit as number | undefined) ?? 25;
    const { rows, total } = await searchConversations(
      orgId,
      {
        q: typeof args.q === "string" ? args.q : undefined,
        channel: args.channel as "whatsapp" | "instagram" | undefined,
        tags: args.tags as string[] | undefined,
        tagsMode: args.tags_mode as "any" | "all" | undefined,
        stageId,
        origin: args.origin as string | undefined,
        unread: args.unread as boolean | undefined,
        handoff: args.handoff as boolean | undefined,
        aiPaused: args.ai_paused as boolean | undefined,
        activeFrom: typeof args.active_from === "string" ? dayStartUtc(args.active_from, timeZone) : undefined,
        activeTo:
          typeof args.active_to === "string" ? dayStartUtc(addDaysToKey(args.active_to, 1), timeZone) : undefined,
      },
      { cursor: decodeKeyset(args.cursor), limit }
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      data: {
        workspace: { id: orgId, name: workspace!.name },
        total_matching: total,
        conversations: page.map((r) => conversationOut(r.conversation, r.contact, r.stageName, timeZone, r.preview)),
        next_cursor: rows.length > limit && last ? encodeKeyset(new Date(last.sortKey), last.conversation.id) : null,
        truncated: rows.length > limit,
        aviso_contenido_de_terceros: THIRD_PARTY_NOTICE,
      },
    };
  },
};

const getConversationTool: AssistantTool = {
  name: "get_conversation",
  title: "Leer una conversación",
  description:
    "Lee una conversación: sus mensajes en orden (quién escribió cada uno: cliente, agente de IA, persona del equipo, celular, API, campaña o historial importado), con las transcripciones de notas de voz y los resúmenes que el CRM hizo de imágenes, PDFs y videos, y las líneas del agente (derivaciones, silencios, errores). Trae los más recientes; para ver más atrás pasá el next_before que devuelve.",
  input: z.object({
    workspace: workspaceParam,
    conversation_id: z.string().max(64),
    before: z.string().max(200).optional().describe("El next_before de la llamada anterior para seguir hacia atrás."),
    limit: limitParam(50, 100),
    include_events: z.boolean().optional().describe("Default true: incluye las líneas del agente."),
    timezone: z.string().max(64).optional(),
  }),
  needsWorkspace: true,
  describe: () => "Leyó una conversación",
  async run({ workspace }, args) {
    const orgId = workspace!.id;
    const timeZone = resolveTimeZone(args.timezone);
    const found = await findConversation(orgId, String(args.conversation_id));
    if (!found) throw new ToolNotFoundError("No encontré esa conversación en esta empresa.");
    const limit = (args.limit as number | undefined) ?? 50;
    const { rows, hasMore, oldest } = await readThread(orgId, found.conversation.id, {
      before: decodeKeyset(args.before),
      limit,
    });

    let events: { at: string | null; kind: string; text: string }[] = [];
    if (args.include_events !== false && rows.length > 0) {
      const from = rows[0]!.message.createdAt;
      const to = hasMore || args.before ? rows[rows.length - 1]!.message.createdAt : new Date();
      const evRows = await getDb()
        .select()
        .from(schema.conversationEvent)
        .where(
          scoped(
            schema.conversationEvent.organizationId,
            orgId,
            eq(schema.conversationEvent.conversationId, found.conversation.id),
            and(gte(schema.conversationEvent.createdAt, from), lte(schema.conversationEvent.createdAt, to))
          )
        )
        .orderBy(asc(schema.conversationEvent.createdAt))
        .limit(200);
      events = evRows.map((row) => {
        const dto = serializeEvent(row);
        return {
          at: isoInZone(row.createdAt, timeZone),
          kind: row.kind,
          text: foreign(eventText(dto, (iso) => isoInZone(new Date(iso), timeZone) ?? iso).text, 400) ?? "",
        };
      });
    }

    const contactName = found.contact.name;
    return {
      summary: `Leyó la conversación con ${foreign(contactName, 60) ?? "un contacto"}`,
      data: {
        workspace: { id: orgId, name: workspace!.name },
        conversation: conversationOut(found.conversation, found.contact, found.stageName, timeZone),
        messages: rows.map((r) => {
          const msg = r.message;
          const author = messageAuthor({
            direction: msg.direction,
            source: msg.source,
            aiGenerated: msg.aiGenerated,
            sentByUserId: msg.sentByUserId,
            apiKeyId: msg.apiKeyId,
            fromCampaign: r.fromCampaign,
          });
          const hasMedia = r.mediaMime !== null || msg.mediaState !== null;
          const kind = hasMedia ? attachmentKind(r.mediaMime, msg.type) : null;
          return {
            id: msg.id,
            at: isoInZone(msg.createdAt, timeZone),
            direction: msg.direction === "in" ? "entrante" : "saliente",
            author,
            author_name: author === "equipo" ? r.authorName : null,
            type: msg.type,
            status: msg.direction === "out" ? msg.status : null,
            text: foreign(msg.text, 4000),
            attachment: hasMedia
              ? {
                  kind,
                  file_name: foreign(r.mediaFileName, 120),
                  mime: r.mediaMime,
                  size_bytes: r.mediaSize,
                  duration_ms: r.mediaDuration,
                  state: msg.mediaState,
                  summary: kind === "audio" ? null : foreign(msg.mediaSummary, 2000),
                  summary_source: kind === "audio" ? (msg.text ? "transcripción (va en text)" : null) : msg.mediaSummary ? "resumen del CRM" : null,
                }
              : null,
          };
        }),
        events,
        next_before: hasMore && oldest ? encodeKeyset(oldest.createdAt, oldest.id) : null,
        truncated: hasMore,
        aviso_contenido_de_terceros: THIRD_PARTY_NOTICE,
      },
    };
  },
};

const DEFAULT_SEARCH_DAYS = 90;
const MAX_SEARCH_DAYS = 365;

const searchMessagesTool: AssistantTool = {
  name: "search_messages",
  title: "Buscar dentro de los mensajes",
  description:
    "Busca DENTRO de los mensajes: una palabra o frase en el texto (incluye transcripciones de notas de voz; no distingue tildes ni mayúsculas), por ejemplo «precio», «seña» o «cancelar», y/o los mensajes con adjunto (has_attachment) o de ciertos tipos (audio, image, video, document, sticker). Devuelve las coincidencias más nuevas con un fragmento, el adjunto y su resumen del CRM, y la conversación; para el contexto completo usá get_conversation. Ventana default: últimos 90 días (máximo 365).",
  input: z.object({
    workspace: workspaceParam,
    text: z.string().max(100).optional().describe("Palabra o frase (mínimo 2 letras). Opcional si usás has_attachment o types."),
    has_attachment: z.boolean().optional().describe("true: solo mensajes con adjunto (audio, imagen, video, documento, sticker)."),
    types: z
      .array(z.enum(["audio", "image", "video", "document", "sticker"]))
      .max(5)
      .optional()
      .describe("Tipos de mensaje a incluir."),
    from: dateParam.optional().describe("Desde este día (AAAA-MM-DD). Default: hace 90 días."),
    to: dateParam.optional().describe("Hasta este día inclusive. Default: hoy."),
    channel: z.enum(["whatsapp", "instagram"]).optional(),
    direction: z.enum(["inbound", "outbound", "any"]).optional().describe("inbound: lo que escribieron los clientes."),
    timezone: z.string().max(64).optional(),
    cursor: z.string().max(200).optional(),
    limit: limitParam(25, 50),
  }),
  needsWorkspace: true,
  describe: (args) =>
    args.text ? `Buscó «${String(args.text).slice(0, 40)}» en los mensajes` : "Buscó mensajes con adjuntos",
  async run({ workspace, now }, args) {
    const orgId = workspace!.id;
    const timeZone = resolveTimeZone(args.timezone);
    const to = typeof args.to === "string" ? dayStartUtc(addDaysToKey(args.to, 1), timeZone) : now;
    const from =
      typeof args.from === "string"
        ? dayStartUtc(args.from, timeZone)
        : new Date(to.getTime() - DEFAULT_SEARCH_DAYS * 24 * 3600 * 1000);
    if (from >= to) throw new ToolInputError("La fecha «from» tiene que ser anterior a «to».");
    if (to.getTime() - from.getTime() > (MAX_SEARCH_DAYS + 1) * 24 * 3600 * 1000) {
      throw new ToolInputError(`La búsqueda abarca como máximo ${MAX_SEARCH_DAYS} días.`);
    }
    const text = typeof args.text === "string" ? args.text.trim() : "";
    const types = args.types as string[] | undefined;
    if (text.length < 2 && args.has_attachment !== true && !(types && types.length > 0)) {
      throw new ToolInputError("Indicá un texto de al menos 2 letras, o has_attachment / types.");
    }
    const limit = (args.limit as number | undefined) ?? 25;
    const direction = args.direction === "inbound" ? "in" : args.direction === "outbound" ? "out" : undefined;
    const { rows, hasMore } = await searchMessages(
      orgId,
      {
        text: text.length >= 2 ? text : "",
        hasAttachment: args.has_attachment === true,
        types,
        from,
        to,
        channel: args.channel as "whatsapp" | "instagram" | undefined,
        direction,
      },
      { cursor: decodeKeyset(args.cursor), limit }
    );
    const last = rows[rows.length - 1];
    return {
      data: {
        workspace: { id: orgId, name: workspace!.name },
        searched: {
          text: text || null,
          has_attachment: args.has_attachment === true,
          types: types ?? null,
          from: isoInZone(from, timeZone),
          to: isoInZone(to, timeZone),
        },
        matches: rows.map((r) => ({
          conversation_id: r.message.conversationId,
          contact: { id: r.contactId, name: foreign(r.contactName, 80) },
          message_id: r.message.id,
          at: isoInZone(r.message.createdAt, timeZone),
          author: messageAuthor({
            direction: r.message.direction,
            source: r.message.source,
            aiGenerated: r.message.aiGenerated,
            sentByUserId: r.message.sentByUserId,
            apiKeyId: r.message.apiKeyId,
            fromCampaign: r.fromCampaign,
          }),
          type: r.message.type,
          snippet: foreign(snippetAround(r.message.text ?? "", text), 400),
          attachment:
            r.mediaMime !== null || r.message.mediaState !== null
              ? {
                  kind: attachmentKind(r.mediaMime, r.message.type),
                  file_name: foreign(r.mediaFileName, 120),
                  state: r.message.mediaState,
                  summary: foreign(r.message.mediaSummary, 1000),
                }
              : null,
        })),
        next_cursor: hasMore && last ? encodeKeyset(last.message.createdAt, last.message.id) : null,
        truncated: hasMore,
        aviso_contenido_de_terceros: THIRD_PARTY_NOTICE,
      },
    };
  },
};

export const conversationTools: AssistantTool[] = [searchConversationsTool, getConversationTool, searchMessagesTool];
