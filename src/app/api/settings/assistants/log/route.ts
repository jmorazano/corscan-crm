import { withOwner } from "@/lib/api";
import { listAccessLog } from "@/server/assistants/log";

export const dynamic = "force-dynamic";

/** Registro de consultas de los asistentes en esta empresa (040, FR-025). */
export const GET = withOwner(async (session, req: Request) => {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const page = await listAccessLog(session.organizationId, {
    cursor: url.searchParams.get("cursor"),
    limit: Number.isFinite(limit) ? limit : 50,
  });
  return Response.json(page);
});
