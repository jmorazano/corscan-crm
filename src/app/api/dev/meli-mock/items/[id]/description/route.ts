import { mockGuard } from "@/lib/dev-guard";
import { apiGate, getMeliMockState } from "@/server/dev/meli-mock-state";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = mockGuard() ?? apiGate(req);
  if (guard) return guard;
  const s = getMeliMockState();
  s.calls.description++;
  const { id } = await params;
  const text = s.descriptions.get(id);
  if (!text) return Response.json({ message: "not found", status: 404 }, { status: 404 });
  return Response.json({ text: "", plain_text: text, last_updated: "2026-09-20T12:00:00.000Z" });
}
