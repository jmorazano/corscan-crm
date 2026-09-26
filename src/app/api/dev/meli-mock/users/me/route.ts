import { mockGuard } from "@/lib/dev-guard";
import { apiGate, getMeliMockState } from "@/server/dev/meli-mock-state";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = mockGuard() ?? apiGate(req);
  if (guard) return guard;
  const s = getMeliMockState();
  return Response.json({ id: Number(s.userId), nickname: s.nickname, site_id: "MLA", country_id: "AR" });
}
