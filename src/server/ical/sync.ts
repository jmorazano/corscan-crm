import { asc, eq, isNull, lt, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { fetchFeed, organizationTimezone } from "./feed";
import { decryptUnitUrl, listUnitRows } from "./integration";

/**
 * Lectura periódica de los calendarios (051). Un ticker in-process (como
 * 023/042/044) lee las unidades cuya última lectura tiene más de 15 min, de
 * a UNA y espaciadas (nunca ráfagas contra Airbnb). Un feed caído conserva
 * el último snapshot bueno; el error queda como código propio.
 */

type UnitRow = typeof schema.icalUnit.$inferSelect;

export const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const TICK_MS = 60 * 1000;
const PER_TICK = 20;
const SPACING_MS = 1_500;
/** «Leer ahora»: una vez por minuto por empresa. */
export const MANUAL_SYNC_COOLDOWN_MS = 60 * 1000;

type SyncState = {
  ticker: ReturnType<typeof setInterval> | null;
  ticking: boolean;
  inFlight: Set<string>;
  manual: Map<string, number>;
};

const g = globalThis as unknown as { __icalSync?: SyncState };
const state: SyncState = (g.__icalSync ??= {
  ticker: null,
  ticking: false,
  inFlight: new Set(),
  manual: new Map(),
});

export type UnitSyncOutcome = "ok" | "unchanged" | "failed" | "skipped";

/** Lee un feed y actualiza el snapshot. Nunca lanza. */
export async function syncUnit(row: UnitRow, tz?: string, now = new Date()): Promise<UnitSyncOutcome> {
  if (state.inFlight.has(row.id)) return "skipped";
  state.inFlight.add(row.id);
  try {
    let url: string;
    try {
      url = decryptUnitUrl(row);
    } catch {
      await mark(row, { fetchedAt: now, lastError: "invalid" });
      return "failed";
    }
    const res = await fetchFeed(url, tz ?? (await organizationTimezone(row.organizationId)));
    if (!res.ok) {
      await mark(row, { fetchedAt: now, lastError: res.code });
      return "failed";
    }
    if (res.hash === row.contentHash) {
      await mark(row, { fetchedAt: now, lastOkAt: now, lastError: null });
      return "unchanged";
    }
    await mark(row, {
      fetchedAt: now,
      lastOkAt: now,
      lastError: null,
      busyRanges: res.busy,
      horizonTo: res.horizonTo,
      contentHash: res.hash,
    });
    return "ok";
  } catch (err) {
    console.error("[calendarios] lectura falló:", err instanceof Error ? err.name : "error");
    return "failed";
  } finally {
    state.inFlight.delete(row.id);
  }
}

async function mark(row: UnitRow, patch: Partial<UnitRow>): Promise<void> {
  await getDb()
    .update(schema.icalUnit)
    .set(patch)
    .where(scoped(schema.icalUnit.organizationId, row.organizationId, eq(schema.icalUnit.id, row.id)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type ManualSyncResult =
  | { ok: true; results: Record<string, UnitSyncOutcome> }
  | { ok: false; reason: "cooldown"; retryInMs: number };

/** «Leer ahora» del panel: todas las unidades de la empresa, de a una. */
export async function syncOrganizationNow(organizationId: string, now = new Date()): Promise<ManualSyncResult> {
  const last = state.manual.get(organizationId) ?? 0;
  const wait = last + MANUAL_SYNC_COOLDOWN_MS - now.getTime();
  if (wait > 0) return { ok: false, reason: "cooldown", retryInMs: wait };
  state.manual.set(organizationId, now.getTime());
  const rows = await listUnitRows(organizationId);
  const tz = await organizationTimezone(organizationId);
  const results: Record<string, UnitSyncOutcome> = {};
  for (const [i, row] of rows.entries()) {
    if (i > 0) await sleep(SPACING_MS / 3);
    results[row.id] = await syncUnit(row, tz);
  }
  return { ok: true, results };
}

/** Una vuelta del ticker: las más viejas primero, de a una. */
export async function runSyncTick(now = new Date(), spacingMs = SPACING_MS): Promise<number> {
  if (state.ticking) return 0;
  state.ticking = true;
  try {
    const cutoff = new Date(now.getTime() - SYNC_INTERVAL_MS);
    // Barrido de instancia (todas las empresas): cada fila lleva su
    // organization_id y cada escritura vuelve a pasar por `scoped()`.
    const due = await getDb()
      .select()
      .from(schema.icalUnit)
      .where(or(isNull(schema.icalUnit.fetchedAt), lt(schema.icalUnit.fetchedAt, cutoff)))
      .orderBy(asc(schema.icalUnit.fetchedAt))
      .limit(PER_TICK);
    const tzByOrg = new Map<string, string>();
    for (const [i, row] of due.entries()) {
      if (i > 0 && spacingMs > 0) await sleep(spacingMs);
      let tz = tzByOrg.get(row.organizationId);
      if (!tz) {
        tz = await organizationTimezone(row.organizationId);
        tzByOrg.set(row.organizationId, tz);
      }
      await syncUnit(row, tz);
    }
    return due.length;
  } catch (err) {
    console.error("[calendarios] vuelta del ticker falló:", err instanceof Error ? err.message : err);
    return 0;
  } finally {
    state.ticking = false;
  }
}

export function startIcalTicker(): void {
  if (state.ticker) return;
  state.ticker = setInterval(() => {
    void runSyncTick();
  }, TICK_MS);
  state.ticker.unref?.();
}

/** Solo E2E: deja todas las unidades de una empresa como leídas hace `ageMs`. */
export async function ageSnapshotsForTest(organizationId: string, ageMs: number, now = new Date()): Promise<void> {
  const at = new Date(now.getTime() - ageMs);
  await getDb()
    .update(schema.icalUnit)
    .set({ fetchedAt: at, lastOkAt: at })
    .where(scoped(schema.icalUnit.organizationId, organizationId));
}
