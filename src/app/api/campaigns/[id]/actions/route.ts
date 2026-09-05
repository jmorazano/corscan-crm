import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { freezeRecipients } from "@/server/campaigns/recipients";
import {
  publishProgress,
  spawnCampaignRunner,
} from "@/server/campaigns/runner";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const actionSchema = z.object({
  action: z.enum(["launch", "pause", "resume", "cancel"]),
});

/**
 * Acciones de campaña (004, contrato campaigns-api.md). Toda transición es
 * un UPDATE guardado por el estado de origen (monotónica); pause/resume
 * incrementan runner_generation para invalidar corridas viejas.
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, actionSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaign)
    .where(
      scoped(
        schema.campaign.organizationId,
        session.organizationId,
        eq(schema.campaign.id, id)
      )
    )
    .limit(1);
  const campaign = rows[0];
  if (!campaign) return apiError(404, "not_found", "Campaña no encontrada");

  switch (body.data.action) {
    case "launch": {
      if (campaign.status !== "draft") {
        return apiError(409, "invalid_transition", "Solo se lanza un borrador");
      }
      const templates = campaign.templateId
        ? await db
            .select({ status: schema.template.status })
            .from(schema.template)
            .where(eq(schema.template.id, campaign.templateId))
            .limit(1)
        : [];
      if (templates[0]?.status !== "approved") {
        return apiError(
          422,
          "template_not_approved",
          "La plantilla de la campaña no está aprobada"
        );
      }
      const frozen = await freezeRecipients(campaign);
      if (frozen === 0) {
        return apiError(
          422,
          "segment_empty",
          "El segmento elegible está vacío: nadie con consentimiento (y sin baja) matchea esas etiquetas"
        );
      }
      const launched = await db
        .update(schema.campaign)
        .set({
          status: "running",
          launchedAt: campaign.launchedAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.campaign.id, campaign.id),
            eq(schema.campaign.status, "draft")
          )
        )
        .returning();
      if (!launched[0]) {
        return apiError(409, "invalid_transition", "La campaña ya cambió de estado");
      }
      spawnCampaignRunner(campaign.id);
      await publishProgress(launched[0]);
      return Response.json({ ok: true, frozen }, { status: 202 });
    }

    case "pause": {
      // La pausa manual SIEMPRE gana: también sobre una pausa automática
      // (daily_limit/channel/error) — así el ticker no la resucita.
      const paused = await db
        .update(schema.campaign)
        .set({
          status: "paused",
          pausedReason: "manual",
          runnerGeneration: sql`${schema.campaign.runnerGeneration} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.campaign.id, campaign.id),
            inArray(schema.campaign.status, ["running", "paused"])
          )
        )
        .returning();
      if (!paused[0]) {
        return apiError(409, "invalid_transition", "La campaña no está en curso");
      }
      await publishProgress(paused[0]);
      return Response.json({ ok: true });
    }

    case "resume": {
      const resumed = await db
        .update(schema.campaign)
        .set({
          status: "running",
          pausedReason: null,
          runnerGeneration: sql`${schema.campaign.runnerGeneration} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.campaign.id, campaign.id),
            eq(schema.campaign.status, "paused")
          )
        )
        .returning();
      if (!resumed[0]) {
        return apiError(409, "invalid_transition", "La campaña no está pausada");
      }
      spawnCampaignRunner(campaign.id);
      await publishProgress(resumed[0]);
      return Response.json({ ok: true }, { status: 202 });
    }

    case "cancel": {
      const cancelled = await db
        .update(schema.campaign)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          runnerGeneration: sql`${schema.campaign.runnerGeneration} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.campaign.id, campaign.id),
            inArray(schema.campaign.status, ["running", "paused"])
          )
        )
        .returning();
      if (!cancelled[0]) {
        return apiError(
          409,
          "invalid_transition",
          "Solo se cancela una campaña en curso o pausada"
        );
      }
      // Los pendientes quedan omitidos de forma definitiva.
      await db
        .update(schema.campaignRecipient)
        .set({ status: "skipped", skipReason: "cancelled" })
        .where(
          and(
            eq(schema.campaignRecipient.campaignId, campaign.id),
            eq(schema.campaignRecipient.status, "pending")
          )
        );
      await publishProgress(cancelled[0]);
      return Response.json({ ok: true });
    }
  }
});
