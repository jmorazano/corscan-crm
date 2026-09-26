import { apiError, withOwner } from "@/lib/api";
import { startInstagramHistoryImport } from "@/server/instagram/history";

export const dynamic = "force-dynamic";

/**
 * Importa (o vuelve a importar) el historial de Instagram Direct (023). Es
 * idempotente: lo ya importado no se duplica. Corre en segundo plano; el
 * estado se lee en `GET /api/integrations/instagram` (`integration.history`).
 */
export const POST = withOwner(async (session) => {
  const res = await startInstagramHistoryImport(session.organizationId);
  if (res.started) return Response.json({ started: true }, { status: 202 });
  if (res.reason === "running") {
    return apiError(409, "in_progress", "Ya hay una importación en curso");
  }
  if (res.reason === "reconnect_required") {
    return apiError(409, "reconnect_required", "La conexión con Instagram venció: reconectá la cuenta");
  }
  return apiError(409, "not_connected", "No hay una cuenta de Instagram conectada");
});
