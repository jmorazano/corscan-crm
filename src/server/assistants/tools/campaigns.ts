import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { DEFAULT_METRICS_TIMEZONE } from "@/lib/metrics";
import { friendlyDeliveryError } from "@/lib/meta-errors";
import { addDaysToKey, parseDateKey, zonedToUtc } from "@/lib/time";
import { isoInZone, THIRD_PARTY_NOTICE } from "@/lib/assistants/format";
import { CAMPAIGN_STATUSES, likePattern } from "@/server/campaigns/manage";
import { campaignCountsMany, type CampaignCounts } from "@/server/campaigns/stats";
import { sanitizeForeignText } from "@/server/mcp/sanitize";
import {
  ToolInputError,
  ToolNotFoundError,
  resolveTimeZone,
  workspaceParam,
  type AssistantTool,
} from "./common";

/**
 * Campañas (040, contracts/mcp-tools.md §4–5). Las cantidades salen de
 * `campaignCountsMany`, la misma cuenta del detalle de campaña del CRM.
 */

const cmp = schema.campaign;
const rcp = schema.campaignRecipient;

const DEFINITIONS = {
  total: "Destinatarios de la campaña.",
  pending: "Todavía no se les envió (o se está enviando).",
  sent: "Meta aceptó el envío; todavía puede no haberle llegado.",
  delivered: "Le llegó y todavía NO lo leyó.",
  read: "Le llegó y lo leyó.",
  reached: "delivered + read: a cuántos les llegó.",
  replied: "Respondieron después del envío.",
  failed: "No se pudo enviar o Meta no lo entregó (ver failure_reasons).",
  skipped: "No se les envió: dados de baja, ya no elegibles o campaña cancelada.",
  opted_out: "Dentro de skipped: los que estaban dados de baja.",
};

function withDerived(c: CampaignCounts, optedOut?: number) {
  const reached = c.delivered + c.read;
  return {
    counts: { ...c, reached, ...(optedOut !== undefined ? { opted_out: optedOut } : {}) },
    rates: {
      // `sent` (estado del destinatario) ya incluye a los entregados y leídos.
      reached_over_sent: c.sent > 0 ? round(reached / c.sent) : null,
      replied_over_reached: reached > 0 ? round(c.replied / reached) : null,
    },
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Fecha local AAAA-MM-DD → instante UTC del inicio de ese día. */
function dayStart(key: string, timeZone: string): Date {
  const d = parseDateKey(key);
  if (!d) throw new ToolInputError(`Fecha inválida: ${key.slice(0, 20)} (va como AAAA-MM-DD)`);
  return zonedToUtc(timeZone, d.year, d.month, d.day, 0, 0);
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(raw: unknown): { at: Date; id: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime()) || !id) throw new ToolInputError("cursor inválido: usá el next_cursor que devolvió la herramienta");
  return { at, id };
}

const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const listCampaigns: AssistantTool = {
  name: "list_campaigns",
  title: "Campañas",
  description:
    "Lista las campañas de plantillas de WhatsApp con su estado y sus cantidades: enviados, entregados, leídos, a cuántos les llegó (reached), respondidos, fallidos y salteados. Filtra por estado, nombre y fecha de lanzamiento. Más nuevas primero.",
  input: z.object({
    workspace: workspaceParam,
    status: z.array(z.enum(CAMPAIGN_STATUSES)).max(5).optional().describe("Estados a incluir. Vacío = todos."),
    q: z.string().max(80).optional().describe("Parte del nombre de la campaña."),
    launched_from: dateParam.optional().describe("Lanzadas desde este día (AAAA-MM-DD)."),
    launched_to: dateParam.optional().describe("Lanzadas hasta este día inclusive (AAAA-MM-DD)."),
    timezone: z.string().max(64).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(50).optional().describe("Default 25."),
  }),
  needsWorkspace: true,
  describe: (args) => (args.q ? `Listó campañas «${String(args.q).slice(0, 40)}»` : "Listó las campañas"),
  async run({ workspace }, args) {
    const orgId = workspace!.id;
    const timeZone = resolveTimeZone(args.timezone);
    const limit = (args.limit as number | undefined) ?? 25;
    const statuses = (args.status as string[] | undefined) ?? [];
    const q = typeof args.q === "string" ? args.q.trim() : "";
    const cursor = decodeCursor(args.cursor);
    const conds: (SQL | undefined)[] = [
      statuses.length > 0 ? inArray(cmp.status, statuses as (typeof CAMPAIGN_STATUSES)[number][]) : undefined,
      q ? ilike(cmp.name, likePattern(q)) : undefined,
      typeof args.launched_from === "string" ? gte(cmp.launchedAt, dayStart(args.launched_from, timeZone)) : undefined,
      typeof args.launched_to === "string"
        ? lt(cmp.launchedAt, dayStart(addDaysToKey(args.launched_to, 1), timeZone))
        : undefined,
      cursor ? or(lt(cmp.createdAt, cursor.at), and(eq(cmp.createdAt, cursor.at), lt(cmp.id, cursor.id))) : undefined,
    ];
    const rows = await getDb()
      .select({ campaign: cmp, templateName: schema.template.name })
      .from(cmp)
      .leftJoin(schema.template, eq(cmp.templateId, schema.template.id))
      .where(scoped(cmp.organizationId, orgId, ...conds))
      .orderBy(desc(cmp.createdAt), desc(cmp.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const counts = await campaignCountsMany(orgId, page.map((r) => r.campaign.id));
    const last = page[page.length - 1];
    return {
      data: {
        workspace: { id: orgId, name: workspace!.name },
        campaigns: page.map(({ campaign, templateName }) => ({
          id: campaign.id,
          name: sanitizeForeignText(campaign.name, 120),
          template: templateName ?? campaign.templateName ?? "(plantilla borrada)",
          status: campaign.status,
          created_at: isoInZone(campaign.createdAt, timeZone),
          launched_at: isoInZone(campaign.launchedAt, timeZone),
          completed_at: isoInZone(campaign.completedAt, timeZone),
          ...withDerived(counts.get(campaign.id)!),
        })),
        definitions: DEFINITIONS,
        next_cursor: rows.length > limit && last ? encodeCursor(last.campaign.createdAt, last.campaign.id) : null,
        truncated: rows.length > limit,
      },
    };
  },
};

const RECIPIENT_FILTERS = ["none", "replied", "failed", "read", "delivered", "pending", "skipped", "all"] as const;

function recipientWhere(filter: (typeof RECIPIENT_FILTERS)[number]): SQL | undefined {
  switch (filter) {
    case "replied":
      return isNotNull(rcp.repliedAt);
    case "failed":
      return sql`(${rcp.status} = 'failed' or ${schema.message.status} = 'failed')`;
    case "read":
      return eq(schema.message.status, "read");
    case "delivered":
      return eq(schema.message.status, "delivered");
    case "pending":
      return inArray(rcp.status, ["pending", "sending"]);
    case "skipped":
      return eq(rcp.status, "skipped");
    default:
      return undefined;
  }
}

const getCampaign: AssistantTool = {
  name: "get_campaign",
  title: "Detalle de una campaña",
  description:
    "Detalle de UNA campaña: cantidades (enviados, entregados, leídos, reached, respondidos, fallidos, salteados, bajas), tasas, motivos de fallo en castellano y, si se pide, la lista de destinatarios filtrada (por ejemplo los que respondieron). Se busca por campaign_id o por el nombre exacto.",
  input: z.object({
    workspace: workspaceParam,
    campaign_id: z.string().max(64).optional(),
    name: z.string().max(200).optional().describe("Nombre exacto (sin distinguir mayúsculas) si no tenés el id."),
    recipients: z
      .enum(RECIPIENT_FILTERS)
      .optional()
      .describe("Qué destinatarios listar. Default none (solo cantidades)."),
    timezone: z.string().max(64).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(50).optional().describe("Default 25."),
  }),
  needsWorkspace: true,
  describe: (args) =>
    args.name ? `Detalle de la campaña «${String(args.name).slice(0, 60)}»` : "Detalle de una campaña",
  async run({ workspace }, args) {
    const orgId = workspace!.id;
    const timeZone = typeof args.timezone === "string" ? resolveTimeZone(args.timezone) : DEFAULT_METRICS_TIMEZONE;
    const id = typeof args.campaign_id === "string" ? args.campaign_id : null;
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!id && !name) throw new ToolInputError("Indicá campaign_id o name (usá list_campaigns para verlos).");
    const db = getDb();
    const found = await db
      .select({ campaign: cmp, templateName: schema.template.name })
      .from(cmp)
      .leftJoin(schema.template, eq(cmp.templateId, schema.template.id))
      .where(
        scoped(cmp.organizationId, orgId, id ? eq(cmp.id, id) : sql`lower(${cmp.name}) = lower(${name})`)
      )
      .orderBy(desc(cmp.createdAt))
      .limit(6);
    if (found.length === 0) throw new ToolNotFoundError("No encontré esa campaña en esta empresa.");
    if (found.length > 1) {
      throw new ToolInputError(
        `Hay varias campañas con ese nombre: ${found
          .map((f) => `${f.campaign.id} (${f.campaign.status}, creada ${isoInZone(f.campaign.createdAt, timeZone)})`)
          .join("; ")}. Pedila por campaign_id.`
      );
    }
    const { campaign, templateName } = found[0]!;

    const [countsById, optedOutRows, failures] = await Promise.all([
      campaignCountsMany(orgId, [campaign.id]),
      db
        .select({ n: count() })
        .from(rcp)
        .where(and(eq(rcp.organizationId, orgId), eq(rcp.campaignId, campaign.id), eq(rcp.skipReason, "opted_out"))),
      db
        .select({ raw: sql<string | null>`coalesce(${rcp.error}, ${schema.message.error})`, n: count() })
        .from(rcp)
        .leftJoin(schema.message, eq(rcp.messageId, schema.message.id))
        .where(
          and(
            eq(rcp.organizationId, orgId),
            eq(rcp.campaignId, campaign.id),
            sql`(${rcp.status} = 'failed' or ${schema.message.status} = 'failed')`
          )
        )
        .groupBy(sql`1`),
    ]);

    const reasons = new Map<string, number>();
    for (const f of failures) {
      const text = friendlyDeliveryError(f.raw) ?? "Sin detalle del motivo";
      reasons.set(text, (reasons.get(text) ?? 0) + f.n);
    }

    const filter = (args.recipients as (typeof RECIPIENT_FILTERS)[number] | undefined) ?? "none";
    let recipients: unknown[] | undefined;
    let nextCursor: string | null = null;
    if (filter !== "none") {
      const limit = (args.limit as number | undefined) ?? 25;
      const after = typeof args.cursor === "string" && args.cursor ? args.cursor.slice(0, 64) : null;
      const rows = await db
        .select({
          r: rcp,
          name: schema.contact.name,
          phone: schema.contact.phone,
          deliveryStatus: schema.message.status,
          deliveryError: schema.message.error,
        })
        .from(rcp)
        .innerJoin(schema.contact, eq(rcp.contactId, schema.contact.id))
        .leftJoin(schema.message, eq(rcp.messageId, schema.message.id))
        .where(
          and(
            eq(rcp.organizationId, orgId),
            eq(rcp.campaignId, campaign.id),
            recipientWhere(filter),
            after ? gt(rcp.id, after) : undefined
          )
        )
        .orderBy(asc(rcp.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      recipients = page.map(({ r, name: contactName, phone, deliveryStatus, deliveryError }) => ({
        contact_id: r.contactId,
        name: sanitizeForeignText(contactName, 80),
        phone,
        status: r.status,
        delivery_status: deliveryStatus,
        replied_at: isoInZone(r.repliedAt, timeZone),
        sent_at: isoInZone(r.sentAt, timeZone),
        conversation_id: r.conversationId,
        error: friendlyDeliveryError(r.error ?? deliveryError),
        skip_reason: r.skipReason,
      }));
      nextCursor = rows.length > limit ? page[page.length - 1]!.r.id : null;
    }

    return {
      summary: `Detalle de la campaña «${sanitizeForeignText(campaign.name, 60)}»`,
      data: {
        workspace: { id: orgId, name: workspace!.name },
        campaign: {
          id: campaign.id,
          name: sanitizeForeignText(campaign.name, 120),
          template: templateName ?? campaign.templateName ?? "(plantilla borrada)",
          status: campaign.status,
          paused_reason: campaign.pausedReason,
          tag_filter: campaign.tagFilter,
          created_at: isoInZone(campaign.createdAt, timeZone),
          launched_at: isoInZone(campaign.launchedAt, timeZone),
          completed_at: isoInZone(campaign.completedAt, timeZone),
          cancelled_at: isoInZone(campaign.cancelledAt, timeZone),
        },
        ...withDerived(countsById.get(campaign.id)!, optedOutRows[0]?.n ?? 0),
        failure_reasons: [...reasons].map(([reason, n]) => ({ reason, count: n })).sort((a, b) => b.count - a.count),
        definitions: DEFINITIONS,
        ...(recipients
          ? {
              recipients_filter: filter,
              recipients,
              next_cursor: nextCursor,
              truncated: nextCursor !== null,
              aviso_contenido_de_terceros: THIRD_PARTY_NOTICE,
            }
          : {}),
      },
    };
  },
};

export const campaignTools: AssistantTool[] = [listCampaigns, getCampaign];
