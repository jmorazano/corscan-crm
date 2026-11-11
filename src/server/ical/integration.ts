import { asc, count, eq, ne } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { checkAirbnbIcalUrl, icalUrlErrorText } from "@/lib/ical/airbnb-url";
import { checkBookingUrl } from "@/lib/ical/booking-link";
import {
  MAX_UNITS,
  syncErrorText,
  type IcalSettingsInput,
  type IcalSyncError,
  type UnitCreateInput,
  type UnitUpdateInput,
} from "@/lib/ical/input";
import { isStale } from "@/lib/ical/nights";
import { fetchFeed, mockOrigin, organizationTimezone } from "./feed";

/**
 * Calendarios iCal POR EMPRESA (051, constitución 1.16.0 cat. 7). Los carga
 * el PROPIETARIO: por eso cada enlace pasa la allowlist fija de Airbnb y
 * una lectura de prueba antes de guardarse. El enlace es credencial
 * (cifrado); a la UI viaja solo el host, el id de la publicación y los
 * últimos 4 de la llave.
 */

type UnitRow = typeof schema.icalUnit.$inferSelect;
type SettingsRow = typeof schema.icalIntegration.$inferSelect;

export type IcalUnitView = {
  id: string;
  name: string;
  capacity: number;
  description: string | null;
  bookingUrl: string | null;
  feedHost: string;
  listingId: string;
  tokenLast4: string | null;
  position: number;
  fetchedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorText: string | null;
  stale: boolean;
  busyRanges: number;
};

export type IcalView = {
  agentEnabled: boolean;
  bookingUrl: string | null;
  units: IcalUnitView[];
};

export type UnitFailure =
  | { ok: false; reason: "invalid_url"; message: string }
  | { ok: false; reason: "invalid_booking_url"; message: string }
  | { ok: false; reason: "duplicate"; message: string }
  | { ok: false; reason: "limit"; message: string }
  | { ok: false; reason: "feed"; code: IcalSyncError; message: string }
  | { ok: false; reason: "not_found"; message: string };

export async function getSettingsRow(organizationId: string): Promise<SettingsRow | null> {
  const rows = await getDb()
    .select()
    .from(schema.icalIntegration)
    .where(scoped(schema.icalIntegration.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listUnitRows(organizationId: string): Promise<UnitRow[]> {
  return getDb()
    .select()
    .from(schema.icalUnit)
    .where(scoped(schema.icalUnit.organizationId, organizationId))
    .orderBy(asc(schema.icalUnit.position), asc(schema.icalUnit.createdAt));
}

export function toUnitView(row: UnitRow, now = new Date()): IcalUnitView {
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    description: row.description,
    bookingUrl: row.bookingUrl,
    feedHost: row.feedHost,
    listingId: row.listingId,
    tokenLast4: row.tokenLast4,
    position: row.position,
    fetchedAt: row.fetchedAt?.toISOString() ?? null,
    lastOkAt: row.lastOkAt?.toISOString() ?? null,
    lastError: row.lastError,
    lastErrorText: syncErrorText(row.lastError),
    stale: isStale(row, now),
    busyRanges: row.busyRanges.length,
  };
}

export async function getIcalView(organizationId: string, now = new Date()): Promise<IcalView> {
  const [settings, units] = await Promise.all([getSettingsRow(organizationId), listUnitRows(organizationId)]);
  return {
    agentEnabled: settings?.agentEnabled ?? true,
    bookingUrl: settings?.bookingUrl ?? null,
    units: units.map((u) => toUnitView(u, now)),
  };
}

function bookingFailure(): UnitFailure {
  return {
    ok: false,
    reason: "invalid_booking_url",
    message: "El enlace de reservas tiene que ser una dirección https:// válida.",
  };
}

function cleanBooking(raw: string | null | undefined): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw.trim() === "") return { ok: true, value: null };
  const check = checkBookingUrl(raw, { allowHttpLoopback: mockOrigin() !== null });
  return check.ok ? { ok: true, value: check.url } : { ok: false };
}

export async function updateIcalSettings(
  organizationId: string,
  input: IcalSettingsInput
): Promise<{ ok: true } | UnitFailure> {
  const patch: Partial<SettingsRow> = { updatedAt: new Date() };
  if (input.agentEnabled !== undefined) patch.agentEnabled = input.agentEnabled;
  if (input.bookingUrl !== undefined) {
    const booking = cleanBooking(input.bookingUrl);
    if (!booking.ok) return bookingFailure();
    patch.bookingUrl = booking.value;
  }
  await getDb()
    .insert(schema.icalIntegration)
    .values({
      id: newId("icalIntegration"),
      organizationId,
      agentEnabled: patch.agentEnabled ?? true,
      bookingUrl: patch.bookingUrl ?? null,
    })
    .onConflictDoUpdate({ target: schema.icalIntegration.organizationId, set: patch });
  return { ok: true };
}

type CheckedFeed = {
  url: string;
  listingId: string;
  host: string;
  tokenLast4: string | null;
  busy: UnitRow["busyRanges"];
  horizonTo: string | null;
  hash: string;
};

/** Valida el enlace y hace la lectura de prueba (nada se guarda si falla). */
async function checkFeed(organizationId: string, rawUrl: string): Promise<{ ok: true; feed: CheckedFeed } | UnitFailure> {
  const check = checkAirbnbIcalUrl(rawUrl, { mockOrigin: mockOrigin() });
  if (!check.ok) return { ok: false, reason: "invalid_url", message: icalUrlErrorText(check.code) };
  const tz = await organizationTimezone(organizationId);
  const res = await fetchFeed(check.url, tz);
  if (!res.ok) {
    return {
      ok: false,
      reason: "feed",
      code: res.code,
      message:
        res.code === "invalid"
          ? "Ese enlace no devolvió un calendario: copialo de nuevo del Paso 1 de Airbnb."
          : (syncErrorText(res.code) ?? "No se pudo leer el calendario."),
    };
  }
  return {
    ok: true,
    feed: {
      url: check.url,
      listingId: check.listingId,
      host: check.host,
      tokenLast4: check.tokenLast4,
      busy: res.busy,
      horizonTo: res.horizonTo,
      hash: res.hash,
    },
  };
}

async function listingTaken(organizationId: string, listingId: string, exceptId?: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.icalUnit.id })
    .from(schema.icalUnit)
    .where(
      scoped(
        schema.icalUnit.organizationId,
        organizationId,
        eq(schema.icalUnit.listingId, listingId),
        exceptId ? ne(schema.icalUnit.id, exceptId) : undefined
      )
    )
    .limit(1);
  return rows.length > 0;
}

const DUPLICATE: UnitFailure = {
  ok: false,
  reason: "duplicate",
  message: "Ese calendario ya está cargado en otra unidad.",
};

export async function createUnit(
  organizationId: string,
  input: UnitCreateInput
): Promise<{ ok: true; unit: IcalUnitView } | UnitFailure> {
  const [{ total } = { total: 0 }] = await getDb()
    .select({ total: count() })
    .from(schema.icalUnit)
    .where(scoped(schema.icalUnit.organizationId, organizationId));
  if (total >= MAX_UNITS) {
    return { ok: false, reason: "limit", message: `Se pueden cargar hasta ${MAX_UNITS} unidades.` };
  }
  const booking = cleanBooking(input.bookingUrl);
  if (!booking.ok) return bookingFailure();
  const checked = await checkFeed(organizationId, input.icalUrl);
  if (!checked.ok) return checked;
  const { feed } = checked;
  if (await listingTaken(organizationId, feed.listingId)) return DUPLICATE;

  const enc = encryptSecret(feed.url);
  const now = new Date();
  try {
    const [row] = await getDb()
      .insert(schema.icalUnit)
      .values({
        id: newId("icalUnit"),
        organizationId,
        name: input.name,
        capacity: input.capacity,
        description: input.description?.trim() || null,
        bookingUrl: booking.value,
        icalUrlCipher: enc.cipher,
        icalUrlIv: enc.iv,
        icalUrlTag: enc.tag,
        listingId: feed.listingId,
        feedHost: feed.host,
        tokenLast4: feed.tokenLast4,
        position: total,
        busyRanges: feed.busy,
        horizonTo: feed.horizonTo,
        fetchedAt: now,
        lastOkAt: now,
        lastError: null,
        contentHash: feed.hash,
      })
      .returning();
    return { ok: true, unit: toUnitView(row!, now) };
  } catch (err) {
    // Carrera con otra alta del mismo calendario: el UNIQUE decide.
    if (String((err as { code?: string }).code) === "23505") return DUPLICATE;
    throw err;
  }
}

export async function updateUnit(
  organizationId: string,
  unitId: string,
  input: UnitUpdateInput
): Promise<{ ok: true; unit: IcalUnitView } | UnitFailure> {
  const current = await getUnitRow(organizationId, unitId);
  if (!current) return { ok: false, reason: "not_found", message: "La unidad no existe." };
  const booking = cleanBooking(input.bookingUrl);
  if (!booking.ok) return bookingFailure();

  const patch: Partial<UnitRow> = {
    name: input.name,
    capacity: input.capacity,
    description: input.description?.trim() || null,
    bookingUrl: booking.value,
    updatedAt: new Date(),
  };
  const newUrl = input.icalUrl?.trim();
  if (newUrl && newUrl !== decryptUnitUrl(current)) {
    const checked = await checkFeed(organizationId, newUrl);
    if (!checked.ok) return checked;
    const { feed } = checked;
    if (await listingTaken(organizationId, feed.listingId, unitId)) return DUPLICATE;
    const enc = encryptSecret(feed.url);
    const now = new Date();
    Object.assign(patch, {
      icalUrlCipher: enc.cipher,
      icalUrlIv: enc.iv,
      icalUrlTag: enc.tag,
      listingId: feed.listingId,
      feedHost: feed.host,
      tokenLast4: feed.tokenLast4,
      busyRanges: feed.busy,
      horizonTo: feed.horizonTo,
      fetchedAt: now,
      lastOkAt: now,
      lastError: null,
      contentHash: feed.hash,
    } satisfies Partial<UnitRow>);
  }
  const [row] = await getDb()
    .update(schema.icalUnit)
    .set(patch)
    .where(scoped(schema.icalUnit.organizationId, organizationId, eq(schema.icalUnit.id, unitId)))
    .returning();
  if (!row) return { ok: false, reason: "not_found", message: "La unidad no existe." };
  return { ok: true, unit: toUnitView(row) };
}

export async function deleteUnit(organizationId: string, unitId: string): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.icalUnit)
    .where(scoped(schema.icalUnit.organizationId, organizationId, eq(schema.icalUnit.id, unitId)))
    .returning({ id: schema.icalUnit.id });
  return rows.length > 0;
}

export async function reorderUnits(organizationId: string, ids: string[]): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const [position, id] of ids.entries()) {
      await tx
        .update(schema.icalUnit)
        .set({ position })
        .where(scoped(schema.icalUnit.organizationId, organizationId, eq(schema.icalUnit.id, id)));
    }
  });
}

export async function getUnitRow(organizationId: string, unitId: string): Promise<UnitRow | null> {
  const rows = await getDb()
    .select()
    .from(schema.icalUnit)
    .where(scoped(schema.icalUnit.organizationId, organizationId, eq(schema.icalUnit.id, unitId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Descifra el enlace en el momento del uso. Nunca se guarda ni se loguea. */
export function decryptUnitUrl(row: Pick<UnitRow, "icalUrlCipher" | "icalUrlIv" | "icalUrlTag">): string {
  return decryptSecret({ cipher: row.icalUrlCipher, iv: row.icalUrlIv, tag: row.icalUrlTag });
}

/** ¿La empresa tiene calendarios que el agente consulta? (query mínima) */
export async function hasAgentStays(organizationId: string): Promise<boolean> {
  const settings = await getSettingsRow(organizationId);
  if (settings && !settings.agentEnabled) return false;
  const rows = await getDb()
    .select({ id: schema.icalUnit.id })
    .from(schema.icalUnit)
    .where(scoped(schema.icalUnit.organizationId, organizationId))
    .limit(1);
  return rows.length > 0;
}
