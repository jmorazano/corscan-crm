import { withAuth } from "@/lib/api";
import { previewSegment } from "@/server/campaigns/recipients";

export const dynamic = "force-dynamic";

/** Tamaño del segmento elegible HOY (FR-013) — predicado completo. */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const tags = (url.searchParams.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const eligible = await previewSegment(session.organizationId, tags);
  return Response.json({ eligible });
});
