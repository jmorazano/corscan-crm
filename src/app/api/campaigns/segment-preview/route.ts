import { withAuth } from "@/lib/api";
import {
  normalizeArrivedMinDays,
  previewSegment,
} from "@/server/campaigns/recipients";

export const dynamic = "force-dynamic";

/** Tamaño del segmento elegible HOY (FR-013) — predicado completo.
 * 043: `days=N` = solo los que llegaron hace al menos N días. */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const tags = (url.searchParams.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const days = normalizeArrivedMinDays(url.searchParams.get("days"));
  const eligible = await previewSegment(session.organizationId, tags, days);
  return Response.json({ eligible });
});
