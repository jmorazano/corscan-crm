import { and, asc, count, eq, gt, isNotNull } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  campaignPaceMs,
  CampaignError,
  deleteCampaign,
} from "@/server/campaigns/manage";
import { getQuotaUsage } from "@/server/campaigns/quota";
import { previewSegment } from "@/server/campaigns/recipients";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const PAGE_SIZE = 100;

/**
 * Detalle de campaña + destinatarios paginados (cursor por id). El estado
 * de entrega por destinatario sale del JOIN con message (una sola máquina
 * de estados de entrega en el sistema — data-model 004).
 */
export const GET = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();

  const rows = await db
    .select({ campaign: schema.campaign, templateName: schema.template.name })
    .from(schema.campaign)
    .leftJoin(
      schema.template,
      eq(schema.campaign.templateId, schema.template.id)
    )
    .where(
      scoped(
        schema.campaign.organizationId,
        session.organizationId,
        eq(schema.campaign.id, id)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return apiError(404, "not_found", "Campaña no encontrada");
  const campaign = row.campaign;

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");

  const recipients = await db
    .select({
      recipient: schema.campaignRecipient,
      contactName: schema.contact.name,
      contactPhone: schema.contact.phone,
      deliveryStatus: schema.message.status,
      deliveryError: schema.message.error,
    })
    .from(schema.campaignRecipient)
    .innerJoin(
      schema.contact,
      eq(schema.campaignRecipient.contactId, schema.contact.id)
    )
    .leftJoin(
      schema.message,
      eq(schema.campaignRecipient.messageId, schema.message.id)
    )
    .where(
      and(
        eq(schema.campaignRecipient.organizationId, session.organizationId),
        eq(schema.campaignRecipient.campaignId, campaign.id),
        cursor ? gt(schema.campaignRecipient.id, cursor) : undefined
      )
    )
    .orderBy(asc(schema.campaignRecipient.id))
    .limit(PAGE_SIZE + 1);

  const page = recipients.slice(0, PAGE_SIZE);
  const nextCursor =
    recipients.length > PAGE_SIZE ? page[page.length - 1]!.recipient.id : null;

  const statusCounts = await db
    .select({ status: schema.campaignRecipient.status, n: count() })
    .from(schema.campaignRecipient)
    .where(
      and(
        eq(schema.campaignRecipient.organizationId, session.organizationId),
        eq(schema.campaignRecipient.campaignId, campaign.id)
      )
    )
    .groupBy(schema.campaignRecipient.status);
  const deliveryCounts = await db
    .select({ status: schema.message.status, n: count() })
    .from(schema.campaignRecipient)
    .innerJoin(
      schema.message,
      eq(schema.campaignRecipient.messageId, schema.message.id)
    )
    .where(
      and(
        eq(schema.campaignRecipient.organizationId, session.organizationId),
        eq(schema.campaignRecipient.campaignId, campaign.id)
      )
    )
    .groupBy(schema.message.status);
  const repliedRows = await db
    .select({ n: count() })
    .from(schema.campaignRecipient)
    .where(
      and(
        eq(schema.campaignRecipient.organizationId, session.organizationId),
        eq(schema.campaignRecipient.campaignId, campaign.id),
        isNotNull(schema.campaignRecipient.repliedAt)
      )
    );

  const s = Object.fromEntries(statusCounts.map((r) => [r.status, r.n]));
  const d = Object.fromEntries(deliveryCounts.map((r) => [r.status, r.n]));

  const eligibleNow =
    campaign.status === "draft"
      ? await previewSegment(session.organizationId, campaign.tagFilter)
      : null;
  const quota = await getQuotaUsage(session.organizationId);

  return Response.json({
    settings: { paceMs: campaignPaceMs(), ...quota },
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      pausedReason: campaign.pausedReason,
      templateName:
        row.templateName ?? row.campaign.templateName ?? "(plantilla borrada)",
      tagFilter: campaign.tagFilter,
      variableMode: campaign.variableMode,
      variableText: campaign.variableText,
      createdAt: campaign.createdAt.toISOString(),
      launchedAt: campaign.launchedAt?.toISOString() ?? null,
      completedAt: campaign.completedAt?.toISOString() ?? null,
      cancelledAt: campaign.cancelledAt?.toISOString() ?? null,
      eligibleNow,
    },
    counts: {
      total:
        (s.pending ?? 0) +
        (s.sending ?? 0) +
        (s.sent ?? 0) +
        (s.failed ?? 0) +
        (s.skipped ?? 0),
      pending: (s.pending ?? 0) + (s.sending ?? 0),
      sent: s.sent ?? 0,
      delivered: d.delivered ?? 0,
      read: d.read ?? 0,
      replied: repliedRows[0]?.n ?? 0,
      failed: (s.failed ?? 0) + (d.failed ?? 0),
      skipped: s.skipped ?? 0,
    },
    recipients: page.map((r) => ({
      contactId: r.recipient.contactId,
      name: r.contactName,
      phone: r.contactPhone,
      status: r.recipient.status,
      deliveryStatus: r.deliveryStatus,
      error: r.recipient.error ?? r.deliveryError,
      skipReason: r.recipient.skipReason,
      repliedAt: r.recipient.repliedAt?.toISOString() ?? null,
    })),
    nextCursor,
  });
});

/**
 * Borra una campaña que no está enviando (borrador, completada o cancelada).
 * 409 `in_progress` si está en curso/pausada: cancelala primero.
 */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  try {
    const deleted = await deleteCampaign(session.organizationId, id);
    return Response.json({ ok: true, campaign: deleted });
  } catch (err) {
    if (err instanceof CampaignError) {
      return apiError(err.code === "not_found" ? 404 : 409, err.code, err.message);
    }
    throw err;
  }
});
