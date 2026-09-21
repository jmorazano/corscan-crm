import { withAuth } from "@/lib/api";
import { kbSize, listEntries } from "@/server/kb/service";

export const dynamic = "force-dynamic";

/**
 * Tamaño estimado del knowledge base (FR-020). v1 inyecta el KB completo al
 * prompt; umbral de aviso heurístico (≈6k tokens) en el servicio.
 */
export const GET = withAuth(async (session) => {
  const entries = await listEntries(session.organizationId);
  return Response.json(kbSize(entries));
});
