import { googleApiGuard } from "@/server/dev/google-mock-api";
import { getGoogleMockState } from "@/server/dev/google-mock-state";

export const dynamic = "force-dynamic";

/**
 * freeBusy simulado: ocupados = eventos creados en ese calendario +
 * bloques "externos" cargados por el self-test. Solo intervalos, como el
 * real (research D4). "primary" resuelve al calendario principal.
 */
export async function POST(req: Request) {
  const guard = googleApiGuard(req);
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as {
    timeMin?: string;
    timeMax?: string;
    items?: { id: string }[];
  };
  const s = getGoogleMockState();
  const min = body.timeMin ? Date.parse(body.timeMin) : Number.NEGATIVE_INFINITY;
  const max = body.timeMax ? Date.parse(body.timeMax) : Number.POSITIVE_INFINITY;
  const calendars: Record<string, { busy: { start: string; end: string }[] }> = {};
  for (const item of body.items ?? []) {
    const id = item.id === "primary" ? "agenda@negocio.test" : item.id;
    const inWindow = (b: { start: string; end: string }) =>
      Date.parse(b.start) < max && Date.parse(b.end) > min;
    const busy = [
      ...s.events.filter((e) => e.calendarId === id).map((e) => ({ start: e.start, end: e.end })),
      ...s.busy,
    ].filter(inWindow);
    calendars[item.id] = { busy };
  }
  return Response.json({ kind: "calendar#freeBusy", calendars });
}
