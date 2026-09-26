import { notInArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { MeliAuthError } from "@/lib/meli/oauth";
import { getDescription, getItems, listActiveItemIds, MeliApiError } from "@/lib/meli/client";
import { normalizeItem, type ListingRecord } from "@/lib/meli/listing";
import {
  effectiveSyncStatus,
  getMeliRow,
  withMeliToken,
} from "@/server/meli/integration";

/**
 * Sincronización del snapshot de publicaciones (025, plan D1).
 *
 * - Lock en proceso por empresa: dos disparos simultáneos (el botón y el
 *   turno del agente) comparten la misma corrida.
 * - La descripción se pide solo si la publicación es nueva o cambió
 *   (`last_updated`): una re-sync de 60 avisos sin cambios son 4 pedidos, no
 *   64.
 * - Un fallo deja el snapshot anterior INTACTO (el agente sigue ofreciendo
 *   lo último que se supo) y registra un código propio, jamás el texto de ML.
 * - Upsert + borrado de lo que ya no está activo en una transacción: el
 *   agente nunca ve un inventario a medio escribir.
 */

export type SyncResult =
  | { ok: true; count: number; added: number; updated: number; removed: number; truncated: boolean }
  | { ok: false; error: string };

/** Pasado este tiempo, el turno del agente dispara una re-sync en segundo plano. */
export const STALE_MS = 3 * 60 * 60 * 1000;
const DESCRIPTION_CONCURRENCY = 4;

const globalForSync = globalThis as unknown as { __meliSync?: Map<string, Promise<SyncResult>> };

function running(): Map<string, Promise<SyncResult>> {
  if (!globalForSync.__meliSync) globalForSync.__meliSync = new Map();
  return globalForSync.__meliSync;
}

export function isSyncRunning(organizationId: string): boolean {
  return running().has(organizationId);
}

export function syncListings(organizationId: string): Promise<SyncResult> {
  const map = running();
  const pending = map.get(organizationId);
  if (pending) return pending;
  const task = doSync(organizationId).finally(() => map.delete(organizationId));
  map.set(organizationId, task);
  return task;
}

/** Dispara la sync sin esperarla (callback, botón, turno). Nunca lanza. */
export function syncListingsInBackground(organizationId: string): void {
  void syncListings(organizationId).catch((err) => {
    console.error("[meli] sync en segundo plano falló:", err instanceof Error ? err.message : err);
  });
}

/**
 * Stale-while-revalidate: si el snapshot quedó viejo (o nunca se completó),
 * dispara una sync en segundo plano. Barato: una lectura de la fila.
 */
export async function refreshIfStale(organizationId: string, now = new Date()): Promise<void> {
  const row = await getMeliRow(organizationId);
  if (!row || row.status !== "connected") return;
  if (isSyncRunning(organizationId)) return;
  if (effectiveSyncStatus(row, now) === "running") return;
  const last = row.lastSyncAt?.getTime() ?? 0;
  if (now.getTime() - last < STALE_MS) return;
  syncListingsInBackground(organizationId);
}

async function pool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

function errorCode(err: unknown): string {
  if (err instanceof MeliAuthError) return err.code === "invalid_grant" ? "reconnect_required" : err.code;
  if (err instanceof MeliApiError) return err.code;
  return "internal_error";
}

async function doSync(organizationId: string): Promise<SyncResult> {
  const db = getDb();
  const row = await getMeliRow(organizationId);
  if (!row) return { ok: false, error: "not_connected" };

  await db
    .update(schema.meliIntegration)
    .set({ syncStatus: "running", syncStartedAt: new Date(), updatedAt: new Date() })
    .where(scoped(schema.meliIntegration.organizationId, organizationId));

  try {
    const existing = await db
      .select({
        itemId: schema.meliListing.itemId,
        mlUpdatedAt: schema.meliListing.mlUpdatedAt,
        description: schema.meliListing.description,
      })
      .from(schema.meliListing)
      .where(scoped(schema.meliListing.organizationId, organizationId));
    const known = new Map(existing.map((e) => [e.itemId, e]));

    const { records, truncated } = await withMeliToken(organizationId, async (token) => {
      const { ids, truncated } = await listActiveItemIds(token, row.mlUserId);
      const items = (await getItems(token, ids)).filter(
        (it) => it.status === undefined || it.status === "active"
      );
      const records = await pool(items, DESCRIPTION_CONCURRENCY, async (item) => {
        const prev = typeof item.id === "string" ? known.get(item.id) : undefined;
        const unchanged =
          prev &&
          prev.mlUpdatedAt &&
          item.last_updated &&
          prev.mlUpdatedAt.getTime() === new Date(item.last_updated).getTime();
        let description: string | null = unchanged ? prev.description : null;
        if (!unchanged && typeof item.id === "string") {
          try {
            description = await getDescription(token, item.id);
          } catch (err) {
            // Un token inválido corta la sync entera (se reintenta arriba);
            // cualquier otro error de UNA descripción no tumba el resto.
            if (err instanceof MeliApiError && err.code === "unauthorized") throw err;
            description = prev?.description ?? null;
          }
        }
        return normalizeItem(item, description, row.siteId);
      });
      return {
        records: records.filter((r): r is ListingRecord => r !== null),
        truncated,
      };
    });

    const activeIds = records.map((r) => r.itemId);
    const now = new Date();
    let added = 0;
    let updated = 0;
    const removed = existing.filter((e) => !activeIds.includes(e.itemId)).length;

    await db.transaction(async (tx) => {
      for (const r of records) {
        if (known.has(r.itemId)) updated++;
        else added++;
        const values = {
          title: r.title,
          categoryId: r.categoryId,
          operation: r.operation,
          propertyType: r.propertyType,
          price: r.price,
          currency: r.currency,
          rooms: r.rooms,
          bedrooms: r.bedrooms,
          bathrooms: r.bathrooms,
          parking: r.parking,
          coveredArea: r.coveredArea,
          totalArea: r.totalArea,
          neighborhood: r.neighborhood,
          city: r.city,
          state: r.state,
          addressLine: r.addressLine,
          permalink: r.permalink,
          thumbnail: r.thumbnail,
          features: r.features,
          description: r.description,
          mlUpdatedAt: r.mlUpdatedAt,
          syncedAt: now,
        };
        await tx
          .insert(schema.meliListing)
          .values({ id: newId("meliListing"), organizationId, itemId: r.itemId, ...values })
          .onConflictDoUpdate({
            target: [schema.meliListing.organizationId, schema.meliListing.itemId],
            set: values,
          });
      }
      await tx
        .delete(schema.meliListing)
        .where(
          activeIds.length > 0
            ? scoped(
                schema.meliListing.organizationId,
                organizationId,
                notInArray(schema.meliListing.itemId, activeIds)
              )
            : scoped(schema.meliListing.organizationId, organizationId)
        );
      await tx
        .update(schema.meliIntegration)
        .set({
          syncStatus: "ok",
          lastSyncAt: now,
          lastSyncError: truncated ? "truncated" : null,
          listingsCount: records.length,
          updatedAt: now,
        })
        .where(scoped(schema.meliIntegration.organizationId, organizationId));
    });

    console.info(
      `[meli] org ${organizationId}: ${records.length} publicaciones (+${added} ~${updated} -${removed})`
    );
    return { ok: true, count: records.length, added, updated, removed, truncated };
  } catch (err) {
    const code = errorCode(err);
    console.error(`[meli] sync de ${organizationId} falló: ${code}`);
    await db
      .update(schema.meliIntegration)
      .set({ syncStatus: "failed", lastSyncError: code, updatedAt: new Date() })
      .where(scoped(schema.meliIntegration.organizationId, organizationId));
    return { ok: false, error: code };
  }
}

/** Snapshot completo de la empresa como registros (lo usa el agente). */
export async function loadListings(organizationId: string): Promise<ListingRecord[]> {
  const rows = await getDb()
    .select()
    .from(schema.meliListing)
    .where(scoped(schema.meliListing.organizationId, organizationId));
  return rows.map(toRecord);
}

export function toRecord(r: typeof schema.meliListing.$inferSelect): ListingRecord {
  return {
    itemId: r.itemId,
    title: r.title,
    categoryId: r.categoryId,
    operation: (r.operation as ListingRecord["operation"]) ?? null,
    propertyType: r.propertyType,
    price: r.price,
    currency: r.currency,
    rooms: r.rooms,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    parking: r.parking,
    coveredArea: r.coveredArea,
    totalArea: r.totalArea,
    neighborhood: r.neighborhood,
    city: r.city,
    state: r.state,
    addressLine: r.addressLine,
    permalink: r.permalink,
    thumbnail: r.thumbnail,
    features: Array.isArray(r.features) ? r.features : [],
    description: r.description,
    mlUpdatedAt: r.mlUpdatedAt,
  };
}
