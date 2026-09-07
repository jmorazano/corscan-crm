import { and, count, desc, eq, ilike, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { sanitizeTags } from "@/lib/tags";
import {
  campaignPaceMs,
  likePattern,
  parseCampaignFilters,
} from "@/server/campaigns/manage";
import { getQuotaUsage } from "@/server/campaigns/quota";
import { previewSegment } from "@/server/campaigns/recipients";
import { countVariables } from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

/**
 * Campañas (004, US4 — contrato campaigns-api.md). En counts, el "fallido"
 * FUSIONA el fallo al enviar (recipient.status='failed') y el fallo de
 * entrega asíncrono (message.status='failed' de un enviado) — el caso real
 * más común (número inexistente) sería invisible sin la fusión.
 */
export const GET = withAuth(async (session, req: Request) => {
  const db = getDb();
  const filters = parseCampaignFilters(new URL(req.url).searchParams);
  const campaigns = await db
    .select({
      campaign: schema.campaign,
      templateName: schema.template.name,
    })
    .from(schema.campaign)
    .leftJoin(
      schema.template,
      eq(schema.campaign.templateId, schema.template.id)
    )
    .where(
      scoped(
        schema.campaign.organizationId,
        session.organizationId,
        and(
          filters.statuses.length > 0
            ? inArray(schema.campaign.status, filters.statuses)
            : undefined,
          filters.q ? ilike(schema.campaign.name, likePattern(filters.q)) : undefined
        )
      )
    )
    .orderBy(desc(schema.campaign.createdAt));

  // Un borrador no tiene destinatarios (se congelan al lanzar): se muestra
  // cuántos contactos son elegibles HOY con su filtro, como en el alta.
  const eligibleNow = new Map<string, number>();
  await Promise.all(
    campaigns
      .filter((c) => c.campaign.status === "draft")
      .map(async ({ campaign: c }) => {
        eligibleNow.set(
          c.id,
          await previewSegment(session.organizationId, c.tagFilter)
        );
      })
  );
  const [quota, paceMs] = [await getQuotaUsage(session.organizationId), campaignPaceMs()];

  const statusCounts = await db
    .select({
      campaignId: schema.campaignRecipient.campaignId,
      status: schema.campaignRecipient.status,
      n: count(),
    })
    .from(schema.campaignRecipient)
    .where(
      eq(schema.campaignRecipient.organizationId, session.organizationId)
    )
    .groupBy(
      schema.campaignRecipient.campaignId,
      schema.campaignRecipient.status
    );

  const deliveryCounts = await db
    .select({
      campaignId: schema.campaignRecipient.campaignId,
      status: schema.message.status,
      n: count(),
    })
    .from(schema.campaignRecipient)
    .innerJoin(
      schema.message,
      eq(schema.campaignRecipient.messageId, schema.message.id)
    )
    .where(
      eq(schema.campaignRecipient.organizationId, session.organizationId)
    )
    .groupBy(schema.campaignRecipient.campaignId, schema.message.status);

  const repliedCounts = await db
    .select({
      campaignId: schema.campaignRecipient.campaignId,
      n: count(),
    })
    .from(schema.campaignRecipient)
    .where(
      and(
        eq(schema.campaignRecipient.organizationId, session.organizationId),
        isNotNull(schema.campaignRecipient.repliedAt)
      )
    )
    .groupBy(schema.campaignRecipient.campaignId);

  const byId = new Map<string, Record<string, number>>();
  const bump = (campaignId: string, key: string, n: number) => {
    const entry = byId.get(campaignId) ?? {};
    entry[key] = (entry[key] ?? 0) + n;
    byId.set(campaignId, entry);
  };
  for (const r of statusCounts) bump(r.campaignId, r.status, r.n);
  for (const r of deliveryCounts) {
    if (r.status === "delivered" || r.status === "read") bump(r.campaignId, r.status, r.n);
    if (r.status === "failed") bump(r.campaignId, "deliveryFailed", r.n);
  }
  for (const r of repliedCounts) bump(r.campaignId, "replied", r.n);

  return Response.json({
    settings: { paceMs, ...quota },
    campaigns: campaigns.map(({ campaign: c, templateName }) => {
      const k = byId.get(c.id) ?? {};
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        pausedReason: c.pausedReason,
        templateName: templateName ?? c.templateName ?? "(plantilla borrada)",
        tagFilter: c.tagFilter,
        variableMode: c.variableMode,
        createdAt: c.createdAt.toISOString(),
        launchedAt: c.launchedAt?.toISOString() ?? null,
        completedAt: c.completedAt?.toISOString() ?? null,
        cancelledAt: c.cancelledAt?.toISOString() ?? null,
        eligibleNow: eligibleNow.get(c.id) ?? null,
        counts: {
          total:
            (k.pending ?? 0) +
            (k.sending ?? 0) +
            (k.sent ?? 0) +
            (k.failed ?? 0) +
            (k.skipped ?? 0),
          pending: (k.pending ?? 0) + (k.sending ?? 0),
          sent: k.sent ?? 0,
          delivered: k.delivered ?? 0,
          read: k.read ?? 0,
          replied: k.replied ?? 0,
          failed: (k.failed ?? 0) + (k.deliveryFailed ?? 0),
          skipped: k.skipped ?? 0,
        },
      };
    }),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  templateId: z.string().min(1),
  tagFilter: z.array(z.string().max(80)).max(30).default([]),
  variableMode: z.enum(["contact_name", "fixed"]).default("contact_name"),
  variableText: z.string().trim().max(500).optional(),
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const templates = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        session.organizationId,
        eq(schema.template.id, body.data.templateId)
      )
    )
    .limit(1);
  const template = templates[0];
  if (!template) return apiError(404, "not_found", "Plantilla no encontrada");
  const variables = countVariables(template.body);
  if (variables > 1) {
    return apiError(422, "invalid", "v1 admite una sola variable {{1}}");
  }
  if (
    variables === 1 &&
    body.data.variableMode === "fixed" &&
    !body.data.variableText?.trim()
  ) {
    return apiError(
      422,
      "invalid",
      "La plantilla tiene {{1}}: indicá el texto fijo o usá el nombre del contacto"
    );
  }

  const inserted = await db
    .insert(schema.campaign)
    .values({
      id: newId("campaign"),
      organizationId: session.organizationId,
      name: body.data.name,
      templateId: template.id,
      templateName: template.name,
      tagFilter: sanitizeTags(body.data.tagFilter),
      variableMode: body.data.variableMode,
      variableText: body.data.variableText?.trim() || null,
    })
    .returning({ id: schema.campaign.id });
  return Response.json({ id: inserted[0]!.id }, { status: 201 });
});
