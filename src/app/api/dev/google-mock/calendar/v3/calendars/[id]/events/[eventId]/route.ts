import { googleApiGuard } from "@/server/dev/google-mock-api";
import { getGoogleMockState } from "@/server/dev/google-mock-state";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; eventId: string }> };

/** events.delete simulado: 204 si existía, 410 si ya no (como Google). */
export async function DELETE(req: Request, ctx: Params) {
  const guard = googleApiGuard(req);
  if (guard) return guard;
  const { eventId } = await ctx.params;
  const s = getGoogleMockState();
  const before = s.events.length;
  s.events = s.events.filter((e) => e.id !== decodeURIComponent(eventId));
  if (s.events.length === before) {
    return Response.json({ error: { code: 410, message: "Resource has been deleted" } }, { status: 410 });
  }
  return new Response(null, { status: 204 });
}
