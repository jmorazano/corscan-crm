import { googleApiGuard } from "@/server/dev/google-mock-api";
import { getGoogleMockState, nextMockN } from "@/server/dev/google-mock-state";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function resolveCalendar(id: string): string {
  const decoded = decodeURIComponent(id);
  return decoded === "primary" ? "agenda@negocio.test" : decoded;
}

/** events.insert simulado. */
export async function POST(req: Request, ctx: Params) {
  const guard = googleApiGuard(req);
  if (guard) return guard;
  const calendarId = resolveCalendar((await ctx.params).id);
  const body = (await req.json().catch(() => ({}))) as {
    summary?: string;
    description?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
  };
  if (!body.start?.dateTime || !body.end?.dateTime) {
    return Response.json({ error: { code: 400, message: "Missing start/end" } }, { status: 400 });
  }
  const s = getGoogleMockState();
  const event = {
    id: `evt_${nextMockN()}`,
    calendarId,
    summary: body.summary ?? "(sin título)",
    description: body.description,
    start: new Date(body.start.dateTime).toISOString(),
    end: new Date(body.end.dateTime).toISOString(),
  };
  s.events.push(event);
  return Response.json({
    kind: "calendar#event",
    id: event.id,
    status: "confirmed",
    summary: event.summary,
    start: { dateTime: event.start },
    end: { dateTime: event.end },
  });
}

/** events.list simulado (solo para inspección del self-test). */
export async function GET(req: Request, ctx: Params) {
  const guard = googleApiGuard(req);
  if (guard) return guard;
  const calendarId = resolveCalendar((await ctx.params).id);
  const items = getGoogleMockState().events.filter((e) => e.calendarId === calendarId);
  return Response.json({ kind: "calendar#events", items });
}
