import { mockGuard } from "@/lib/dev-guard";
import { getIcalMockState, renderMockFeed } from "@/server/dev/ical-mock-state";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ file: string }> };

/** Feed iCal simulado de una publicación (051): `/calendar/ical/<id>.ics`. */
export async function GET(_req: Request, ctx: Params) {
  const guard = mockGuard();
  if (guard) return guard;
  const { file } = await ctx.params;
  const m = /^(\d+)\.ics$/.exec(file);
  if (!m) return new Response("not found", { status: 404 });
  const id = m[1]!;
  const s = getIcalMockState();
  s.hits.set(id, (s.hits.get(id) ?? 0) + 1);
  if (s.delayMs > 0) await new Promise((r) => setTimeout(r, s.delayMs));
  const always = s.failAlways.get(id);
  const next = s.failNext.get(id);
  if (next !== undefined) s.failNext.delete(id);
  const fail = next ?? always;
  if (fail !== undefined) return new Response("error", { status: fail, headers: { "content-type": "text/plain" } });
  if (s.redirectNext.delete(id)) {
    return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
  }
  if (s.garbageNext.delete(id)) {
    return new Response("<!doctype html><html><body>Iniciá sesión</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response(renderMockFeed(id, s), {
    status: 200,
    headers: { "content-type": "text/calendar;charset=utf-8", "cache-control": "no-cache" },
  });
}
