import {
  and,
  arrayContains,
  count,
  eq,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sanitizeTags } from "@/lib/tags";

/**
 * Elegibilidad y congelado de destinatarios (004, FR-013/FR-014).
 * Predicado completo del data-model: consentimiento registrado, sin baja,
 * sin archivo, NO de prueba (columna is_test real — el sandbox no depende
 * del archivado, que es reversible), y match de etiquetas (vacío = todos;
 * si no, AL MENOS una) y, desde 043, «llegaron hace al menos N días».
 * 023: solo contactos de WhatsApp — Instagram no admite plantillas ni envíos
 * iniciados por el negocio, y el consentimiento `inbound` de un DM de
 * Instagram no es consentimiento para WhatsApp.
 */

/** 043: días válidos del filtro «llegaron hace al menos N días». */
export const ARRIVED_MIN_DAYS_MAX = 365;

export function normalizeArrivedMinDays(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  return n >= 1 && n <= ARRIVED_MIN_DAYS_MAX ? n : null;
}

/**
 * 043: llegó hace al menos N días = su último origen registrado (anuncio o
 * regla por frase) o, sin origen, su alta. El corte se calcula acá (la BD
 * guarda UTC sin zona) y viaja como texto ISO.
 */
function arrivedBefore(arrivedMinDays: number | null | undefined, now: Date) {
  const days = normalizeArrivedMinDays(arrivedMinDays);
  if (days === null) return undefined;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60_000);
  return sql`coalesce(${schema.contact.originAt}, ${schema.contact.createdAt}) <= ${cutoff.toISOString()}::timestamp`;
}

function eligibilityWhere(
  organizationId: string,
  tagFilter: string[],
  arrivedMinDays?: number | null,
  now: Date = new Date()
) {
  const tags = sanitizeTags(tagFilter);
  return and(
    eq(schema.contact.organizationId, organizationId),
    isNotNull(schema.contact.consentSource),
    isNull(schema.contact.optedOutAt),
    isNull(schema.contact.archivedAt),
    eq(schema.contact.isTest, false),
    eq(schema.contact.channel, "whatsapp"),
    tags.length > 0
      ? or(...tags.map((t) => arrayContains(schema.contact.tags, [t])))
      : undefined,
    arrivedBefore(arrivedMinDays, now)
  );
}

export async function previewSegment(
  organizationId: string,
  tagFilter: string[],
  arrivedMinDays?: number | null
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ n: count() })
    .from(schema.contact)
    .where(eligibilityWhere(organizationId, tagFilter, arrivedMinDays));
  return rows[0]?.n ?? 0;
}

/**
 * Congela la lista al lanzar: una fila por contacto elegible, idempotente
 * por el unique (campaign_id, contact_id) — relanzar tras un fallo parcial
 * no duplica. Devuelve cuántos quedaron congelados en total.
 */
export async function freezeRecipients(campaign: {
  id: string;
  organizationId: string;
  tagFilter: string[];
  arrivedMinDays?: number | null;
}): Promise<number> {
  const db = getDb();
  const eligible = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      eligibilityWhere(
        campaign.organizationId,
        campaign.tagFilter,
        campaign.arrivedMinDays
      )
    );

  const CHUNK = 500;
  for (let i = 0; i < eligible.length; i += CHUNK) {
    const chunk = eligible.slice(i, i + CHUNK);
    await db
      .insert(schema.campaignRecipient)
      .values(
        chunk.map((c) => ({
          id: newId("campaignRecipient"),
          organizationId: campaign.organizationId,
          campaignId: campaign.id,
          contactId: c.id,
        }))
      )
      .onConflictDoNothing({
        target: [
          schema.campaignRecipient.campaignId,
          schema.campaignRecipient.contactId,
        ],
      });
  }

  const total = await db
    .select({ n: count() })
    .from(schema.campaignRecipient)
    .where(
      and(
        eq(schema.campaignRecipient.organizationId, campaign.organizationId),
        eq(schema.campaignRecipient.campaignId, campaign.id)
      )
    );
  return total[0]?.n ?? 0;
}

/**
 * Re-verificación por destinatario en el momento del envío (el opt-out o el
 * archivo pueden sobrevenir después del congelado).
 */
export function isStillEligible(
  organizationId: string,
  contact: typeof schema.contact.$inferSelect
): boolean {
  return (
    contact.consentSource !== null &&
    contact.optedOutAt === null &&
    contact.archivedAt === null &&
    !contact.isTest &&
    (contact.channel ?? "whatsapp") === "whatsapp" &&
    contact.organizationId === organizationId
  );
}
