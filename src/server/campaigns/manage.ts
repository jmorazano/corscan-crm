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
