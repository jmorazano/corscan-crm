import { mockGuard } from "@/lib/dev-guard";
import { apiGate, getMeliMockState } from "@/server/dev/meli-mock-state";

export const dynamic = "force-dynamic";

/** Publicaciones activas del vendedor, paginadas como ML (limit/offset). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = mockGuard() ?? apiGate(req);
  if (guard) return guard;
  const s = getMeliMockState();
  s.calls.search++;
  const { id } = await params;
  if (id !== s.userId) return Response.json({ message: "forbidden", status: 403 }, { status: 403 });
  const url = new URL(req.url);
  const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 50));
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const active = s.items.filter((i) => i.status === "active").map((i) => i.id!);
  return Response.json({
    seller_id: s.userId,
    results: active.slice(offset, offset + limit),
    paging: { limit, offset, total: active.length },
  });
}
