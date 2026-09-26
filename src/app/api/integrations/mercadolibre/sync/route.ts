import { apiError, withOwner } from "@/lib/api";
import { getMeliRow } from "@/server/meli/integration";
import { syncListingsInBackground } from "@/server/meli/sync";

export const dynamic = "force-dynamic";

/**
 * «Sincronizar ahora» (025): arranca la sync en segundo plano y responde
 * 202 al toque; la página consulta el GET hasta que termina. Dos clics
 * seguidos comparten la misma corrida (lock en `sync.ts`).
 */
export const POST = withOwner(async (session) => {
  const row = await getMeliRow(session.organizationId);
  if (!row) return apiError(404, "not_connected", "Mercado Libre no está conectado");
  if (row.status === "reconnect_required") {
    return apiError(409, "reconnect_required", "Volvé a conectar la cuenta de Mercado Libre");
  }
  syncListingsInBackground(session.organizationId);
  return Response.json({ started: true }, { status: 202 });
});
