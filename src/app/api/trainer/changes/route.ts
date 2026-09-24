import { withOwner } from "@/lib/api";
import { listChanges } from "@/server/trainer/changes";

export const dynamic = "force-dynamic";

/** Cambios recientes aplicados por el entrenador (015, panel derecho). */
export const GET = withOwner(async (session, req: Request) => {
  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("limit") ?? "30");
  const limit = Number.isFinite(raw) ? Math.min(100, Math.max(1, Math.trunc(raw))) : 30;
  const changes = await listChanges(session.organizationId, limit);
  return Response.json({ changes });
});
