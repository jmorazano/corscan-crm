import { and, count, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Cantidades de una campaña (004/010): estados del destinatario, entrega por
 * JOIN a `message` (entregado y leído NO viven en el destinatario) y
 * respondidos por `replied_at`. La usan el detalle de la campaña y los
 * asistentes (040), así las cifras son las mismas en los dos lados.
 */

export type CampaignCounts = {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  skipped: number;
};

export async function campaignCounts(organizationId: string, campaignId: string): Promise<CampaignCounts> {
  const byId = await campaignCountsMany(organizationId, [campaignId]);
  return byId.get(campaignId) ?? countsFrom({}, {}, 0);
}

function countsFrom(
  s: Record<string, number>,
  d: Record<string, number>,
  replied: number
): CampaignCounts {
  return {
    total: (s.pending ?? 0) + (s.sending ?? 0) + (s.sent ?? 0) + (s.failed ?? 0) + (s.skipped ?? 0),
    pending: (s.pending ?? 0) + (s.sending ?? 0),
    sent: s.sent ?? 0,
    delivered: d.delivered ?? 0,
    read: d.read ?? 0,
    replied,
    failed: (s.failed ?? 0) + (d.failed ?? 0),
    skipped: s.skipped ?? 0,
  };
}

/** Las mismas cantidades para varias campañas en tres consultas. */
export async function campaignCountsMany(
  organizationId: string,
  campaignIds: readonly string[]
): Promise<Map<string, CampaignCounts>> {
  const out = new Map<string, CampaignCounts>();
  if (campaignIds.length === 0) return out;
  const db = getDb();
  const r = schema.campaignRecipient;
  const sameCampaigns = and(eq(r.organizationId, organizationId), inArray(r.campaignId, [...campaignIds]));
  const [statusCounts, deliveryCounts, repliedRows] = await Promise.all([
    db
      .select({ campaignId: r.campaignId, status: r.status, n: count() })
      .from(r)
      .where(sameCampaigns)
      .groupBy(r.campaignId, r.status),
    db
      .select({ campaignId: r.campaignId, status: schema.message.status, n: count() })
      .from(r)
      .innerJoin(schema.message, eq(r.messageId, schema.message.id))
      .where(sameCampaigns)
      .groupBy(r.campaignId, schema.message.status),
    db
      .select({ campaignId: r.campaignId, n: count() })
      .from(r)
      .where(and(sameCampaigns, isNotNull(r.repliedAt)))
      .groupBy(r.campaignId),
  ]);

  const group = (rows: { campaignId: string; status: string | null; n: number }[]) => {
    const map = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const bucket = map.get(row.campaignId) ?? {};
      bucket[row.status ?? ""] = row.n;
      map.set(row.campaignId, bucket);
    }
    return map;
  };
  const s = group(statusCounts);
  const d = group(deliveryCounts);
  const replied = new Map(repliedRows.map((row) => [row.campaignId, row.n]));
  for (const id of campaignIds) {
    out.set(id, countsFrom(s.get(id) ?? {}, d.get(id) ?? {}, replied.get(id) ?? 0));
  }
  return out;
}
