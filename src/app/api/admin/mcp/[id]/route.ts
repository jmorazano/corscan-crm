import { apiError, withSuperAdmin } from "@/lib/api";
import { getMcpConnectorDetail } from "@/server/mcp/admin";

export const dynamic = "force-dynamic";

/**
 * Detalle de UNA empresa en el panel consolidado (016, contrato
 * `admin-mcp-api.md`): el mismo DTO de la lista más las últimas 20 llamadas
 * de la bitácora.
 *
 * La bitácora es lo que de verdad dice si la conexión anda: qué herramienta
 * se llamó, si salió bien, con qué código falló y cuánto tardó. De los
 * argumentos sube un resumen de campos escalares de una allowlist, saneado y
 * truncado — nunca el objeto completo, que arrastra texto del cliente.
 *
 * `null` cuando la empresa no existe: no hay forma de distinguir «no existe»
 * de «no tiene conector» sin filtrarla, y la primera es un 404 honesto.
 */
type Params = { params: Promise<{ id: string }> };

export const GET = withSuperAdmin(async (_ctx, _req: Request, routeCtx: Params) => {
  const { id } = await routeCtx.params;
  const detail = await getMcpConnectorDetail(id);
  if (!detail) {
    return apiError(404, "organization_not_found", "La empresa no existe");
  }
  return Response.json({ organization: detail });
});
