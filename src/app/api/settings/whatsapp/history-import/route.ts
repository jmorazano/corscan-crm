import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import {
  getHistoryImport,
  historyImportStats,
  HistorySyncError,
  requestHistorySync,
  serializeHistoryImport,
} from "@/server/whatsapp/history-sync";

export const dynamic = "force-dynamic";

/** Estado de la importación del historial del celular (017). */
export const GET = withAuth(async (session) => {
  const [creds, row, stats] = await Promise.all([
    getCredentialsByOrg(session.organizationId),
    getHistoryImport(session.organizationId),
    historyImportStats(session.organizationId),
  ]);
  return Response.json({
    connected: Boolean(creds),
    import: row ? { ...serializeHistoryImport(row), ...stats } : null,
  });
});

const bodySchema = z.object({ days: z.number().int().min(1).max(180).optional() });

const STATUS: Record<HistorySyncError["code"], number> = {
  not_connected: 409,
  in_progress: 409,
  meta_error: 422,
  meta_unavailable: 503,
};

/** Pide a Meta contactos + historial (owner). */
export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede importar el historial");
  }
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  try {
    const row = await requestHistorySync(session.organizationId, { days: body.data.days });
    return Response.json({ import: serializeHistoryImport(row) });
  } catch (err) {
    if (err instanceof HistorySyncError) {
      return apiError(STATUS[err.code], err.code, err.message);
    }
    throw err;
  }
});
