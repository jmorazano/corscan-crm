import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";

/**
 * Gestión de campañas (007): filtros de la lista, borrado y datos del ciclo
 * de vida que la UI muestra al operador. Las transiciones de estado siguen
 * en `/api/campaigns/[id]/actions` (monotónicas, guard WHERE).
 */

export const CAMPAIGN_STATUSES = [
  "draft",
  "running",
  "paused",
  "completed",
  "cancelled",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export type CampaignFilters = { statuses: CampaignStatus[]; q: string };

const MAX_Q = 80;

/**
 * `status=draft,running` (lista, valores desconocidos ignorados; vacío =
 * todos) y `q=` (búsqueda por nombre, case-insensitive, acotada).
 */
export function parseCampaignFilters(params: URLSearchParams): CampaignFilters {
  const raw = params.get("status") ?? "";
  const seen = new Set<CampaignStatus>();
  for (const part of raw.split(",")) {
    const s = part.trim().toLowerCase();
    if ((CAMPAIGN_STATUSES as readonly string[]).includes(s)) {
      seen.add(s as CampaignStatus);
    }
  }
  const q = (params.get("q") ?? "").trim().slice(0, MAX_Q);
  return { statuses: [...seen], q };
}

/** Escapa los comodines de LIKE para que la búsqueda sea literal. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/**
 * Solo se borra lo que NO está enviando: borrador (nunca envió), completada
 * o cancelada. Una campaña en curso/pausada se cancela primero — así el
 * runner (generación) y el at-most-once no se pisan con un DELETE.
 */
export function canDeleteCampaign(status: string): boolean {
  return status === "draft" || status === "completed" || status === "cancelled";
}

export class CampaignError extends Error {
  code: "not_found" | "in_progress";
  constructor(code: CampaignError["code"], message: string) {
    super(message);
    this.name = "CampaignError";
    this.code = code;
  }
}

/**
 * Borra la campaña y su tracking de destinatarios (FK cascade). Los
 * mensajes ya enviados quedan en sus conversaciones: son historial del
 * contacto, no de la campaña. El DELETE va guardado por estado para que una
 * campaña que se lanzó entre el SELECT y el DELETE no desaparezca a mitad
 * de envío.
 */
export async function deleteCampaign(
  organizationId: string,
  campaignId: string
): Promise<{ id: string; name: string }> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.campaign.id,
      name: schema.campaign.name,
      status: schema.campaign.status,
    })
    .from(schema.campaign)
    .where(
      scoped(
        schema.campaign.organizationId,
        organizationId,
        eq(schema.campaign.id, campaignId)
      )
    )
    .limit(1);
  const campaign = rows[0];
  if (!campaign) throw new CampaignError("not_found", "Campaña no encontrada");
  if (!canDeleteCampaign(campaign.status)) {
    throw new CampaignError(
      "in_progress",
      "La campaña está en curso o pausada: cancelala antes de borrarla"
    );
  }

  const deleted = await db
    .delete(schema.campaign)
    .where(
      scoped(
        schema.campaign.organizationId,
        organizationId,
        and(
          eq(schema.campaign.id, campaignId),
          inArray(schema.campaign.status, ["draft", "completed", "cancelled"])
        )
      )
    )
    .returning({ id: schema.campaign.id });
  if (!deleted[0]) {
    throw new CampaignError(
      "in_progress",
      "La campaña cambió de estado mientras la borrabas"
    );
  }
  return { id: campaign.id, name: campaign.name };
}

/** Ritmo de envío de la instancia (ms entre mensajes), para la UI. */
export function campaignPaceMs(): number {
  return getEnv().CAMPAIGN_PACE_MS;
}

/**
 * Reencola los destinatarios FALLIDOS de una campaña (010): la única
 * excepción deliberada a la monotonicidad de estados, guardada por estado de
 * origen e idempotente (re-ejecutarla sin fallos nuevos devuelve 0).
 *
 * Dos clases de fallo, dos resets:
 * - `status='failed'`: el canal rechazó el envío (nunca hubo wamid).
 * - `status='sent'` con `message.status='failed'`: aceptado y luego fallido
 *   por webhook (p. ej. facturación o límite de marketing 131049). Se
 *   limpian message_id/wa_message_id/sent_at para que el reintento cree un
 *   mensaje NUEVO — el fallido original queda en la conversación como
 *   historial.
 * Los `skipped` (baja, cancelación) NO se tocan: fueron decisiones, no
 * fallos.
 */
export async function retryFailedRecipients(campaign: {
  id: string;
  organizationId: string;
}): Promise<number> {
  const db = getDb();

  const sendFailed = await db
    .update(schema.campaignRecipient)
    .set({ status: "pending", error: null })
    .where(
      and(
        eq(schema.campaignRecipient.organizationId, campaign.organizationId),
        eq(schema.campaignRecipient.campaignId, campaign.id),
        eq(schema.campaignRecipient.status, "failed")
      )
    )
    .returning({ id: schema.campaignRecipient.id });

  const deliveryFailedRows = await db
    .select({ id: schema.campaignRecipient.id })
    .from(schema.campaignRecipient)
    .innerJoin(
      schema.message,
      eq(schema.campaignRecipient.messageId, schema.message.id)
    )
    .where(
      and(
        eq(schema.campaignRecipient.organizationId, campaign.organizationId),
        eq(schema.campaignRecipient.campaignId, campaign.id),
        eq(schema.campaignRecipient.status, "sent"),
        eq(schema.message.status, "failed")
      )
    );
  if (deliveryFailedRows.length > 0) {
    await db
      .update(schema.campaignRecipient)
      .set({
        status: "pending",
        error: null,
        messageId: null,
        waMessageId: null,
        sentAt: null,
      })
      .where(
        and(
          eq(schema.campaignRecipient.organizationId, campaign.organizationId),
          inArray(
            schema.campaignRecipient.id,
            deliveryFailedRows.map((r) => r.id)
          ),
          // Guarda de carrera: solo si sigue en 'sent'.
          eq(schema.campaignRecipient.status, "sent")
        )
      );
  }

  return sendFailed.length + deliveryFailedRows.length;
}
