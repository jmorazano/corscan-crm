import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { getMeliMockState, resetMeliMockState } from "@/server/dev/meli-mock-state";

export const dynamic = "force-dynamic";

/** Estado visible del meli-mock (sin tokens) para el guion E2E. */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  const s = getMeliMockState();
  return Response.json({
    userId: s.userId,
    nickname: s.nickname,
    items: s.items.map((i) => ({ id: i.id, title: i.title, status: i.status, price: i.price })),
    hasRefresh: s.currentRefresh !== null,
    revoked: s.revoked,
    calls: s.calls,
  });
}

const Knobs = z.object({
  reset: z.boolean().optional(),
  nextAuthError: z.string().nullable().optional(),
  failNextApi: z.boolean().optional(),
  expireAccess: z.boolean().optional(),
  revoked: z.boolean().optional(),
  bulkMissing: z.boolean().optional(),
  userId: z.string().regex(/^\d+$/).optional(),
  nickname: z.string().optional(),
  /** Pausa (o reactiva) una publicación: deja de salir en el search. */
  setStatus: z.object({ id: z.string(), status: z.enum(["active", "paused"]) }).optional(),
  setPrice: z.object({ id: z.string(), price: z.number() }).optional(),
});

/** Perillas del camino infeliz. */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const parsed = Knobs.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const k = parsed.data;
  if (k.reset) resetMeliMockState();
  const s = getMeliMockState();
  if (k.nextAuthError !== undefined) s.nextAuthError = k.nextAuthError;
  if (k.failNextApi !== undefined) s.failNextApi = k.failNextApi;
  if (k.expireAccess !== undefined) s.expireAccess = k.expireAccess;
  if (k.revoked !== undefined) s.revoked = k.revoked;
  if (k.bulkMissing !== undefined) s.bulkMissing = k.bulkMissing;
  if (k.userId) s.userId = k.userId;
  if (k.nickname) s.nickname = k.nickname;
  if (k.setStatus) {
    const it = s.items.find((i) => i.id === k.setStatus!.id);
    if (it) {
      it.status = k.setStatus.status;
      it.last_updated = new Date().toISOString();
    }
  }
  if (k.setPrice) {
    const it = s.items.find((i) => i.id === k.setPrice!.id);
    if (it) {
      it.price = k.setPrice.price;
      it.last_updated = new Date().toISOString();
    }
  }
  return Response.json({ ok: true });
}
