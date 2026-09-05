import { and, count, eq, gt, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv } from "@/lib/env";
import { publish } from "@/server/events/bus";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { isWindowOpen } from "@/server/inbox/window";
import { SendError } from "@/server/inbox/send";
import { reconcileContactWaId } from "@/server/contacts";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import {
  countVariables,
  sendTemplateCore,
  TemplateError,
} from "@/server/whatsapp/templates";
import { isStillEligible } from "@/server/campaigns/recipients";
import {
  getQuotaUsage,
  QuotaError,
  releaseQuota,
  reserveQuota,
} from "@/server/campaigns/quota";

/**
 * Runner de campañas (004, US4 — contrato campaigns-api.md §Runner).
 * Esqueleto del Laboratorio con la política invertida: una campaña NO es
 * descartable, así que reinicio = revive; y un mensaje de WhatsApp NO es
 * re-emitible, así que la fila ambigua muere en `failed` visible
 * (AT-MOST-ONCE, FR-018) — jamás re-envío automático.
 */

const BREAKER_THRESHOLD = 3;
const RETRY_BACKOFF_MS = 2000;

type Campaign = typeof schema.campaign.$inferSelect;

function paceMs(): number {
  const base = getEnv().CAMPAIGN_PACE_MS;
  // Jitter ±30%: los envíos a ritmo perfectamente regular son la firma de un
  // bot; el ruido protege el quality rating.
  return Math.round(base * (0.7 + Math.random() * 0.6));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Dispara el runner fire-and-forget (patrón lab/runner.ts:52-58). */
export function spawnCampaignRunner(campaignId: string): void {
  void executeCampaign(campaignId).catch(async (err) => {
    // Crash no manejado: la campaña NO queda zombie — pausa con motivo
    // visible y el operador puede reanudar sin reiniciar el servidor.
    console.error(`[campañas] runner de ${campaignId} falló:`, err);
    await pauseCampaign(campaignId, "error").catch(() => undefined);
  });
}

async function loadCampaign(campaignId: string): Promise<Campaign | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.campaign)
    .where(eq(schema.campaign.id, campaignId))
    .limit(1);
  return rows[0] ?? null;
}

/** Transición running→paused con guard (monotónica) + SSE. */
async function pauseCampaign(
  campaignId: string,
  reason: "manual" | "daily_limit" | "channel" | "error"
): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(schema.campaign)
    .set({ status: "paused", pausedReason: reason, updatedAt: new Date() })
    .where(
      and(
        eq(schema.campaign.id, campaignId),
        eq(schema.campaign.status, "running")
      )
    )
    .returning();
  const campaign = updated[0];
  if (!campaign) return false;
  await publishProgress(campaign);
  return true;
}

export async function publishProgress(campaign: Campaign): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ status: schema.campaignRecipient.status, n: count() })
    .from(schema.campaignRecipient)
    .where(
      and(
        eq(schema.campaignRecipient.organizationId, campaign.organizationId),
        eq(schema.campaignRecipient.campaignId, campaign.id)
      )
    )
    .groupBy(schema.campaignRecipient.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const counts = {
    total: rows.reduce((acc, r) => acc + r.n, 0),
    pending: (by.pending ?? 0) + (by.sending ?? 0),
    sent: by.sent ?? 0,
    failed: by.failed ?? 0,
    skipped: by.skipped ?? 0,
  };
  publish(campaign.organizationId, {
    type: "campaign.progress",
    data: {
      campaignId: campaign.id,
      status: campaign.status,
      pausedReason: campaign.pausedReason,
      counts,
    },
  });
}

/**
 * Resolución at-most-once de filas `sending` residuales. Corre al ARRANCAR
 * toda corrida (launch, resume, ticker, revive del boot): cubre también la
 * campaña que murió estando paused. Idempotente.
 */
async function resolveStaleSending(campaign: Campaign): Promise<void> {
  const db = getDb();
  const stale = await db
    .select()
    .from(schema.campaignRecipient)
    .where(
      and(
        eq(schema.campaignRecipient.organizationId, campaign.organizationId),
        eq(schema.campaignRecipient.campaignId, campaign.id),
        eq(schema.campaignRecipient.status, "sending")
      )
    );

  for (const row of stale) {
    if (row.waMessageId) {
      // Graph respondió antes del crash: el mensaje SALIÓ → sent, y se
      // repone el registro de cupo si el crash lo dejó sin insertar.
      await db
        .update(schema.campaignRecipient)
        .set({ status: "sent", sentAt: row.sentAt ?? new Date() })
        .where(
          and(
            eq(schema.campaignRecipient.id, row.id),
            eq(schema.campaignRecipient.status, "sending")
          )
        );
      const window = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const existing = await db
        .select({ n: count() })
        .from(schema.initiatedSend)
        .where(
          and(
            eq(schema.initiatedSend.organizationId, campaign.organizationId),
            eq(schema.initiatedSend.contactId, row.contactId),
            gt(schema.initiatedSend.sentAt, window)
          )
        );
      if ((existing[0]?.n ?? 0) === 0) {
        await db.insert(schema.initiatedSend).values({
          id: newId("initiatedSend"),
          organizationId: campaign.organizationId,
          contactId: row.contactId,
        });
      }
      continue;
    }
    // Ambiguo (sin wamid): AT-MOST-ONCE — fallo visible, jamás re-envío.
    await db
      .update(schema.campaignRecipient)
      .set({
        status: "failed",
        error: "Interrumpido por un reinicio del servidor (no se reintenta solo)",
      })
      .where(
        and(
          eq(schema.campaignRecipient.id, row.id),
          eq(schema.campaignRecipient.status, "sending")
        )
      );
  }
}

type ClaimResult =
  | { kind: "claimed"; id: string; contactId: string }
  | { kind: "contended" }
  | { kind: "empty" };

/**
 * Claim de la próxima fila pending. El UPDATE guardado (WHERE
 * status='pending') es la parte atómica: si otra corrida ganó la carrera,
 * afecta 0 filas y se reintenta con la siguiente.
 */
async function claimNextRecipient(campaign: Campaign): Promise<ClaimResult> {
  const db = getDb();
  const candidates = await db
    .select({
      id: schema.campaignRecipient.id,
      contactId: schema.campaignRecipient.contactId,
    })
    .from(schema.campaignRecipient)
    .where(
      and(
        eq(schema.campaignRecipient.campaignId, campaign.id),
        eq(schema.campaignRecipient.status, "pending")
      )
    )
    .orderBy(schema.campaignRecipient.id)
    .limit(1);
  const candidate = candidates[0];
  if (!candidate) return { kind: "empty" };

  const claimed = await db
    .update(schema.campaignRecipient)
    .set({ status: "sending" })
    .where(
      and(
        eq(schema.campaignRecipient.id, candidate.id),
        eq(schema.campaignRecipient.status, "pending")
      )
    )
    .returning({ id: schema.campaignRecipient.id });
  if (!claimed[0]) return { kind: "contended" };
  return { kind: "claimed", id: candidate.id, contactId: candidate.contactId };
}

export async function executeCampaign(campaignId: string): Promise<void> {
  const db = getDb();
  const initial = await loadCampaign(campaignId);
  if (!initial || initial.status !== "running") return;
  const generation = initial.runnerGeneration;

  await resolveStaleSending(initial);

  // Plantilla y credenciales pre-resueltas UNA vez (no N descifrados).
  const templates = initial.templateId
    ? await db
        .select()
        .from(schema.template)
        .where(eq(schema.template.id, initial.templateId))
        .limit(1)
    : [];
  const template = templates[0];
  const creds = await getCredentialsByOrg(initial.organizationId);
  if (!template || template.status !== "approved" || !creds) {
    await pauseCampaign(campaignId, "channel");
    return;
  }
  const needsVariable = countVariables(template.body) === 1;

  let consecutiveFailures = 0;
  let lastFailureKey: string | null = null;

  for (;;) {
    // Cancelación cooperativa + generación: pause/resume/cancel y los
    // solapes de deploy invalidan esta corrida entre fila y fila.
    const current = await loadCampaign(campaignId);
    if (!current || current.status !== "running") return;
    if (current.runnerGeneration !== generation) return;

    const claim = await claimNextRecipient(current);
    if (claim.kind === "contended") continue;
    if (claim.kind === "empty") {
      // ¿Terminamos? Completa solo sin pending NI sending residuales.
      const remaining = await db
        .select({ n: count() })
        .from(schema.campaignRecipient)
        .where(
          and(
            eq(schema.campaignRecipient.campaignId, campaignId),
            inArray(schema.campaignRecipient.status, ["pending", "sending"])
          )
        );
      if ((remaining[0]?.n ?? 0) > 0) return; // otra corrida las tiene
      const done = await db
        .update(schema.campaign)
        .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.campaign.id, campaignId),
            eq(schema.campaign.status, "running")
          )
        )
        .returning();
      if (done[0]) await publishProgress(done[0]);
      return;
    }

    const contacts = await db
      .select()
      .from(schema.contact)
      .where(eq(schema.contact.id, claim.contactId))
      .limit(1);
    const contact = contacts[0];

    // Re-verificación de elegibilidad (opt-out/archivo sobrevenidos).
    if (!contact || !isStillEligible(current.organizationId, contact)) {
      await db
        .update(schema.campaignRecipient)
        .set({
          status: "skipped",
          skipReason: contact?.optedOutAt ? "opted_out" : "ineligible",
        })
        .where(eq(schema.campaignRecipient.id, claim.id));
      await publishProgress(current);
      continue;
    }

    const conversation = await getOrCreateConversation(
      current.organizationId,
      contact.id
    );

    let reservationId: string | null = null;
    try {
      if (!isWindowOpen(conversation.lastInboundAt)) {
        try {
          ({ reservationId } = await reserveQuota(
            current.organizationId,
            contact.id
          ));
        } catch (err) {
          if (err instanceof QuotaError) {
            // Cupo agotado: la fila vuelve a la cola y la campaña se pausa
            // sola; el ticker la reanuda al liberarse cupo (FR-015).
            await db
              .update(schema.campaignRecipient)
              .set({ status: "pending" })
              .where(
                and(
                  eq(schema.campaignRecipient.id, claim.id),
                  eq(schema.campaignRecipient.status, "sending")
                )
              );
            await pauseCampaign(campaignId, "daily_limit");
            return;
          }
          throw err;
        }
      }

      const variable = needsVariable
        ? current.variableMode === "fixed"
          ? (current.variableText ?? "")
          : contact.name
        : undefined;

      let result;
      try {
        result = await sendTemplateCore({
          organizationId: current.organizationId,
          template,
          creds,
          conversation,
          contact,
          variable,
        });
      } catch (err) {
        // Un solo reintento para fallos transitorios del canal.
        if (err instanceof SendError && err.code === "meta_unavailable") {
          await sleep(RETRY_BACKOFF_MS);
          result = await sendTemplateCore({
            organizationId: current.organizationId,
            template,
            creds,
            conversation,
            contact,
            variable,
          });
        } else {
          throw err;
        }
      }

      // Wamid + sent en UN update atómico: la ventana ambigua queda en el
      // mínimo físico (entre el 200 de Graph y esta línea).
      await db
        .update(schema.campaignRecipient)
        .set({
          status: "sent",
          waMessageId: result.waMessageId,
          messageId: result.messageId,
          conversationId: conversation.id,
          sentAt: new Date(),
        })
        .where(
          and(
            eq(schema.campaignRecipient.id, claim.id),
            eq(schema.campaignRecipient.status, "sending")
          )
        );
      await reconcileContactWaId(current.organizationId, contact, result.waId);
      consecutiveFailures = 0;
      lastFailureKey = null;
      await publishProgress(current);
    } catch (err) {
      if (reservationId) await releaseQuota(reservationId);

      if (
        err instanceof SendError &&
        (err.code === "opted_out" || err.code === "sandbox_violation")
      ) {
        await db
          .update(schema.campaignRecipient)
          .set({
            status: "skipped",
            skipReason: err.code === "opted_out" ? "opted_out" : "ineligible",
          })
          .where(eq(schema.campaignRecipient.id, claim.id));
        await publishProgress(current);
        continue;
      }

      if (
        (err instanceof TemplateError || err instanceof SendError) &&
        (err.code === "reconnect_required" || err.code === "not_connected")
      ) {
        // Canal caído: la fila vuelve a la cola, la campaña espera al humano.
        await db
          .update(schema.campaignRecipient)
          .set({ status: "pending" })
          .where(
            and(
              eq(schema.campaignRecipient.id, claim.id),
              eq(schema.campaignRecipient.status, "sending")
            )
          );
        await pauseCampaign(campaignId, "channel");
        return;
      }

      const message =
        err instanceof Error ? err.message : "Fallo desconocido del envío";
      await db
        .update(schema.campaignRecipient)
        .set({ status: "failed", error: message })
        .where(eq(schema.campaignRecipient.id, claim.id));
      await publishProgress(current);

      // Circuit breaker (research D5): N fallos consecutivos con la misma
      // causa = problema de clase plantilla/canal, no del destinatario —
      // pausar antes de quemar el segmento entero durante la noche.
      const failureKey =
        err instanceof SendError || err instanceof TemplateError
          ? err.code
          : "unknown";
      consecutiveFailures = failureKey === lastFailureKey ? consecutiveFailures + 1 : 1;
      lastFailureKey = failureKey;
      if (consecutiveFailures >= BREAKER_THRESHOLD) {
        await pauseCampaign(campaignId, "channel");
        return;
      }
    }

    await sleep(paceMs());
  }
}

/**
 * Reanudación automática (T029): SOLO las pausadas por daily_limit. Se
 * invoca del ticker periódico y del PUT de ajustes (subir el límite reanuda
 * al instante). La pausa manual JAMÁS se toca acá.
 */
export async function resumePausedByQuota(organizationId?: string): Promise<void> {
  const db = getDb();
  const paused = await db
    .select()
    .from(schema.campaign)
    .where(
      and(
        eq(schema.campaign.status, "paused"),
        eq(schema.campaign.pausedReason, "daily_limit"),
        organizationId
          ? eq(schema.campaign.organizationId, organizationId)
          : undefined
      )
    );
  const byOrg = new Map<string, Campaign[]>();
  for (const c of paused) {
    const list = byOrg.get(c.organizationId) ?? [];
    list.push(c);
    byOrg.set(c.organizationId, list);
  }

  for (const [orgId, campaigns] of byOrg) {
    const { available } = await getQuotaUsage(orgId);
    if (available <= 0) continue;
    for (const campaign of campaigns) {
      const resumed = await db
        .update(schema.campaign)
        .set({
          status: "running",
          pausedReason: null,
          runnerGeneration: campaign.runnerGeneration + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.campaign.id, campaign.id),
            eq(schema.campaign.status, "paused"),
            eq(schema.campaign.pausedReason, "daily_limit")
          )
        )
        .returning();
      if (resumed[0]) {
        spawnCampaignRunner(campaign.id);
      }
    }
  }
}

const TICKER_MS = 60_000;

const globalTicker = globalThis as unknown as {
  __voceroCampaignTicker?: ReturnType<typeof setInterval>;
};

/** Revive al boot + ticker de reanudación (instrumentation-node). */
export async function reviveCampaigns(): Promise<void> {
  try {
    const db = getDb();
    const running = await db
      .select({ id: schema.campaign.id })
      .from(schema.campaign)
      .where(eq(schema.campaign.status, "running"));
    for (const c of running) {
      spawnCampaignRunner(c.id);
    }
    if (running.length > 0) {
      console.log(`[boot] ${running.length} campaña(s) en curso retomada(s)`);
    }
  } catch (err) {
    console.error("[boot] revive de campañas falló:", err);
  }

  if (!globalTicker.__voceroCampaignTicker) {
    globalTicker.__voceroCampaignTicker = setInterval(() => {
      void resumePausedByQuota().catch((err) =>
        console.error("[campañas] ticker de reanudación falló:", err)
      );
    }, TICKER_MS);
    // El ticker no debe impedir que el proceso termine.
    globalTicker.__voceroCampaignTicker.unref?.();
  }
}
