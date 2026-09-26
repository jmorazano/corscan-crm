import { mockGuard } from "@/lib/dev-guard";
import { apiGate, getMeliMockState } from "@/server/dev/meli-mock-state";

export const dynamic = "force-dynamic";

/** Formato viejo `/items?ids=` (`code` + `body`), vigente hasta el 25-oct-2026. */
export async function GET(req: Request) {
  const guard = mockGuard() ?? apiGate(req);
  if (guard) return guard;
  const s = getMeliMockState();
  s.calls.legacy++;
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
  return Response.json(
    ids.map((id) => {
      const body = s.items.find((i) => i.id === id);
      return body ? { code: 200, body } : { code: 404, body: { message: "not found" } };
    })
  );
}
