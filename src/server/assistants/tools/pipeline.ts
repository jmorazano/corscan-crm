import { and, asc, count, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { eventText } from "@/lib/conversation-events";
import { THIRD_PARTY_NOTICE, isoInZone } from "@/lib/assistants/format";
import { addDaysToKey } from "@/lib/time";
import { serializeEvent } from "@/server/ai/events";
import { resolveStage } from "../queries/conversations";
import {
  ToolInputError,
  dateParam,
  dayStartUtc,
  decodeKeyset,
  encodeKeyset,
  foreign,
  limitParam,
  periodParams,
  resolvePeriod,
  resolveTimeZone,
  workspaceParam,
  type AssistantTool,
} from "./common";

/**
 * Pipeline y actividad del agente (040, contracts/mcp-tools.md §11–12).
 */

const lead = schema.lead;
const stage = schema.pipelineStage;
const ev = schema.conversationEvent;

const getPipelineTool: AssistantTool = {
  name: "get_pipeline",
  title: "Pipeline de leads",
  description:
    "Etapas del pipeline en orden (abiertas, ganada, perdida) con la cantidad de leads en cada una. Con «stage» lista los leads de esa etapa (contacto, conversación, última actividad); con updated_from/updated_to se acota a los que se actualizaron en esas fechas. No hay historial de cambios de etapa: «se movió en el período» = se actualizó en el período.",
  input: z.object({
    workspace: workspaceParam,
    stage: z.string().max(80).optional().describe("Nombre (o id) de la etapa cuyos leads listar."),
    updated_from: dateParam.optional(),
    updated_to: dateParam.optional().describe("Inclusive."),
    timezone: z.string().max(64).optional(),
    cursor: z.string().max(200).optional(),
    limit: limitParam(25, 50),
  }),
  needsWorkspace: true,
  describe: (args) => (args.stage ? `Leads de la etapa «${String(args.stage).slice(0, 40)}»` : "Miró el pipeline"),
  async run({ workspace }, args) {
    const orgId = workspace!.id;
    const timeZone = resolveTimeZone(args.timezone);
    const db = getDb();
    const from = typeof args.updated_from === "string" ? dayStartUtc(args.updated_from, timeZone) : null;
    const to = typeof args.updated_to === "string" ? dayStartUtc(addDaysToKey(args.updated_to, 1), timeZone) : null;
    const leadWhere = and(
      eq(lead.organizationId, orgId),
      sql`exists (select 1 from contact c where c.id = ${lead.contactId} and c.is_test = false)`,
      from ? gte(lead.updatedAt, from) : undefined,
      to ? lt(lead.updatedAt, to) : undefined
    );
    // Conteo calificado a mano: en un SELECT de una sola tabla drizzle no
    // antepone el nombre y `"id"` del subquery apuntaría al lead, no a la etapa.
    const fromIso = from?.toISOString() ?? null;
    const toIso = to?.toISOString() ?? null;
    const leadCount = sql<number>`(
      select count(*)::int from lead l2
      join contact c2 on c2.id = l2.contact_id and c2.is_test = false
      where l2.stage_id = "pipeline_stage"."id"
        and l2.organization_id = ${orgId}
        and (${fromIso}::timestamp is null or l2.updated_at >= ${fromIso}::timestamp)
        and (${toIso}::timestamp is null or l2.updated_at < ${toIso}::timestamp)
    )`;
    const stages = await db
      .select({
        id: stage.id,
        name: stage.name,
        kind: stage.kind,
        position: stage.position,
        leads: leadCount,
      })
      .from(stage)
      .where(scoped(stage.organizationId, orgId))
      .orderBy(asc(stage.position));

    let leads: unknown[] | undefined;
    let nextCursor: string | null = null;
    let stageName: string | null = null;
    if (typeof args.stage === "string" && args.stage.trim()) {
      const st = await resolveStage(orgId, args.stage.startsWith("stg_") ? { id: args.stage } : { name: args.stage });
      if (st.id === null) {
        throw new ToolInputError(`No existe la etapa «${args.stage.slice(0, 60)}». Etapas: ${st.available.join(", ")}.`);
      }
      stageName = st.name;
      const cursor = decodeKeyset(args.cursor);
      const limit = (args.limit as number | undefined) ?? 25;
      const rows = await db
        .select({
          lead,
          contactName: schema.contact.name,
          contactPhone: schema.contact.phone,
          channel: schema.contact.channel,
          conversationId: sql<string | null>`(
            select cv.id from conversation cv
            where cv.contact_id = ${lead.contactId} and cv.is_test = false
            order by cv.last_message_at desc nulls last limit 1
          )`,
        })
        .from(lead)
        .innerJoin(schema.contact, eq(schema.contact.id, lead.contactId))
        .where(
          and(
            leadWhere,
            eq(lead.stageId, st.id),
            cursor ? or(lt(lead.updatedAt, cursor.at), and(eq(lead.updatedAt, cursor.at), lt(lead.id, cursor.id))) : undefined
          )
        )
        .orderBy(desc(lead.updatedAt), desc(lead.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      nextCursor = rows.length > limit && last ? encodeKeyset(last.lead.updatedAt, last.lead.id) : null;
      leads = page.map((r) => ({
        id: r.lead.id,
        contact: {
          id: r.lead.contactId,
          name: foreign(r.contactName, 80),
          phone: r.channel === "instagram" ? null : r.contactPhone,
        },
        conversation_id: r.conversationId,
        updated_at: isoInZone(r.lead.updatedAt, timeZone),
        last_activity_at: isoInZone(r.lead.lastActivityAt, timeZone),
        created_at: isoInZone(r.lead.createdAt, timeZone),
      }));
    }
    return {
      data: {
        workspace: { id: orgId, name: workspace!.name },
        stages: stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, position: s.position, leads: Number(s.leads) })),
        ...(leads
          ? {
              stage: stageName,
              leads,
              next_cursor: nextCursor,
              truncated: nextCursor !== null,
              aviso_contenido_de_terceros: THIRD_PARTY_NOTICE,
            }
          : {}),
        notes: [
          "kind: open = etapa normal, won = ganada, lost = perdida (ahí van también las bajas).",
          "No hay historial de cambios de etapa: los filtros de fecha usan la última actualización del lead.",
        ],
      },
    };
  },
};

const EVENT_KINDS = ["ai_handoff", "ai_silent", "ai_resumed", "ai_error", "ai_toggled", "ai_tool_write"] as const;

const EVENT_LABELS: Record<(typeof EVENT_KINDS)[number], string> = {
  ai_handoff: "Derivó a una persona (atención humana)",
  ai_silent: "Leyó y no respondió (con el motivo)",
  ai_resumed: "Retomó la conversación",
  ai_error: "Error del agente (proveedor de IA, envío)",
  ai_toggled: "Alguien del equipo pausó o activó la IA",
  ai_tool_write: "Escribió en el sistema del tercero (reserva)",
};

const getAgentActivityTool: AssistantTool = {
  name: "get_agent_activity",
  title: "Actividad del agente",
  description:
    "Qué hizo el agente de IA en el período: cuántas veces derivó a una persona, se quedó callado (y por qué), retomó, tuvo errores, fue pausado o escribió en el sistema de reservas. Con list=true trae cada evento con fecha, conversación y motivo en castellano.",
  input: z.object({
    workspace: workspaceParam,
    ...periodParams,
    kinds: z.array(z.enum(EVENT_KINDS)).max(6).optional(),
    list: z.boolean().optional().describe("true: además de las cantidades, lista los eventos."),
    cursor: z.string().max(200).optional(),
    limit: limitParam(25, 50),
  }),
  needsWorkspace: true,
  describe: (args) => `Actividad del agente · ${String(args.from ? `${args.from} a ${args.to}` : args.period ?? "last_30_days")}`,
  async run({ workspace, now }, args) {
    const orgId = workspace!.id;
    const { window: w, timeZone } = resolvePeriod(args, now);
    const kinds = (args.kinds as (typeof EVENT_KINDS)[number][] | undefined) ?? [...EVENT_KINDS];
    const db = getDb();
    const base = scoped(
      ev.organizationId,
      orgId,
      gte(ev.createdAt, w.start),
      lt(ev.createdAt, w.end),
      sql`${ev.kind} in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})`,
      // Calificada a mano (ver `leadCount`): sin join drizzle no antepone la tabla.
      sql`exists (select 1 from conversation cv where cv.id = "conversation_event"."conversation_id" and cv.is_test = false)`
    );
    const [byKind, byReason] = await Promise.all([
      db.select({ kind: ev.kind, n: count() }).from(ev).where(base).groupBy(ev.kind),
      db
        .select({ kind: ev.kind, reason: ev.reason, n: count() })
        .from(ev)
        .where(base)
        .groupBy(ev.kind, ev.reason),
    ]);
    const counts = Object.fromEntries(kinds.map((k) => [k, byKind.find((r) => r.kind === k)?.n ?? 0]));

    let events: unknown[] | undefined;
    let nextCursor: string | null = null;
    if (args.list === true) {
      const cursor = decodeKeyset(args.cursor);
      const limit = (args.limit as number | undefined) ?? 25;
      const rows = await db
        .select({ event: ev, contactName: schema.contact.name })
        .from(ev)
        .innerJoin(schema.conversation, eq(schema.conversation.id, ev.conversationId))
        .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
        .where(and(base, cursor ? or(lt(ev.createdAt, cursor.at), and(eq(ev.createdAt, cursor.at), lt(ev.id, cursor.id))) : undefined))
        .orderBy(desc(ev.createdAt), desc(ev.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      nextCursor = rows.length > limit && last ? encodeKeyset(last.event.createdAt, last.event.id) : null;
      events = page.map((r) => ({
        at: isoInZone(r.event.createdAt, timeZone),
        kind: r.event.kind,
        reason: r.event.reason,
        conversation_id: r.event.conversationId,
        contact_name: foreign(r.contactName, 80),
        text:
          foreign(eventText(serializeEvent(r.event), (iso) => isoInZone(new Date(iso), timeZone) ?? iso).text, 400) ?? "",
      }));
    }
    return {
      summary: `Actividad del agente · ${w.label}`,
      data: {
        workspace: { id: orgId, name: workspace!.name },
        period: { label: w.label, from: w.fromKey, to: w.toKey, timezone: timeZone },
        counts,
        by_reason: byReason.map((r) => ({ kind: r.kind, reason: r.reason, count: r.n })),
        labels: EVENT_LABELS,
        ...(events
          ? { events, next_cursor: nextCursor, truncated: nextCursor !== null, aviso_contenido_de_terceros: THIRD_PARTY_NOTICE }
          : {}),
      },
    };
  },
};

export const pipelineTools: AssistantTool[] = [getPipelineTool, getAgentActivityTool];
