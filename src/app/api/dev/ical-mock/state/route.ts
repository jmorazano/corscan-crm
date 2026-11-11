import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { getIcalMockState, resetIcalMockState } from "@/server/dev/ical-mock-state";

export const dynamic = "force-dynamic";

/** Estado visible del ical-mock (051) para el guion E2E. */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  const s = getIcalMockState();
  return Response.json({
    busy: Object.fromEntries(s.busy),
    hits: Object.fromEntries(s.hits),
    failAlways: Object.fromEntries(s.failAlways),
    guestData: s.guestData,
    delayMs: s.delayMs,
  });
}

const Range = z.object({ from: z.string(), to: z.string() });
const Knobs = z.object({
  reset: z.boolean().optional(),
  setBusy: z.object({ id: z.string().regex(/^\d+$/), ranges: z.array(Range) }).optional(),
  failNext: z.object({ id: z.string(), status: z.number().int() }).optional(),
  failAlways: z.object({ id: z.string(), status: z.number().int().nullable() }).optional(),
  garbageNext: z.string().optional(),
  redirectNext: z.string().optional(),
  guestData: z.boolean().optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
});

/** Perillas del camino infeliz. */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const parsed = Knobs.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "bad knobs" }, { status: 400 });
  const k = parsed.data;
  if (k.reset) resetIcalMockState();
  const s = getIcalMockState();
  if (k.setBusy) s.busy.set(k.setBusy.id, k.setBusy.ranges);
  if (k.failNext) s.failNext.set(k.failNext.id, k.failNext.status);
  if (k.failAlways) {
    if (k.failAlways.status === null) s.failAlways.delete(k.failAlways.id);
    else s.failAlways.set(k.failAlways.id, k.failAlways.status);
  }
  if (k.garbageNext) s.garbageNext.add(k.garbageNext);
  if (k.redirectNext) s.redirectNext.add(k.redirectNext);
  if (k.guestData !== undefined) s.guestData = k.guestData;
  if (k.delayMs !== undefined) s.delayMs = k.delayMs;
  return Response.json({ ok: true });
}
