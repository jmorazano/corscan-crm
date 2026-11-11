import { parseBody, withOwner } from "@/lib/api";
import { icalSettingsSchema } from "@/lib/ical/input";
import { dayGrid } from "@/lib/ical/nights";
import { localDateKey } from "@/lib/time";
import { organizationTimezone } from "@/server/ical/feed";
import { getIcalView, listUnitRows, updateIcalSettings } from "@/server/ical/integration";
import { unitFailureResponse } from "@/server/ical/http";

export const dynamic = "force-dynamic";

/** Días de la grilla del panel (para comparar contra el sistema propio). */
const GRID_DAYS = 30;

/**
 * Calendarios de Airbnb de la empresa (051). Solo el propietario (lectura y
 * escritura: es configuración). Jamás el enlace `.ics` (lleva la llave).
 */
export const GET = withOwner(async (session) => {
  const orgId = session.organizationId;
  const now = new Date();
  const [view, rows, tz] = await Promise.all([getIcalView(orgId, now), listUnitRows(orgId), organizationTimezone(orgId)]);
  let today: string;
  try {
    today = localDateKey(tz, now);
  } catch {
    today = now.toISOString().slice(0, 10);
  }
  const grid = Object.fromEntries(rows.map((r) => [r.id, dayGrid(r.busyRanges, today, GRID_DAYS)]));
  return Response.json({ ...view, today, gridDays: GRID_DAYS, grid });
});

export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, icalSettingsSchema);
  if (!body.ok) return body.response;
  const res = await updateIcalSettings(session.organizationId, body.data);
  if (!res.ok) return unitFailureResponse(res);
  return Response.json({ ok: true });
});

