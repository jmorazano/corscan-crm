import { mockGuard } from "@/lib/dev-guard";
import { apiGate, getMeliMockState } from "@/server/dev/meli-mock-state";

export const dynamic = "force-dynamic";

/** Detalle en tandas (formato nuevo: `status_code` + `id` en la raíz). */
export async function GET(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const s = getMeliMockState();
  if (s.bulkMissing) return Response.json({ message: "not found", status: 404 }, { status: 404 });
  const gate = apiGate(req);
  if (gate) return gate;
  s.calls.bulk++;
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (ids.length > 20) return Response.json({ message: "too many ids", status: 400 }, { status: 400 });
  return Response.json(
    ids.map((id) => {
      const body = s.items.find((i) => i.id === id);
      return body ? { id, status_code: 200, body } : { id, status_code: 404, body: { message: "not found" } };
    })
  );
}
