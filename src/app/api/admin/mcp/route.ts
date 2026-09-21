import { withSuperAdmin } from "@/lib/api";
import {
  filterMcpConnectors,
  listMcpConnectors,
  parseMcpConnectorFilters,
} from "@/server/mcp/admin";

export const dynamic = "force-dynamic";

/**
 * Panel CONSOLIDADO de conectores MCP (016, contrato
 * `specs/016-mcp-connector/contracts/admin-mcp-api.md`).
 *
 * Existe porque el estado de una conexión no se puede gestionar empresa por
 * empresa: lo que el operador necesita es la lista completa, con el conector
 * roto arriba. Las rutas por empresa
 * (`/api/admin/organizations/[id]/mcp`) siguen siendo las de alta, edición y
 * baja; esta es la de OBSERVACIÓN.
 *
 * `withSuperAdmin`: sin sesión → 401; sesión sin rol de plataforma → 403.
 * Es la única razón por la que esta respuesta puede llevar la `endpointUrl`
 * completa (corrección #36). La credencial no viaja nunca: solo
 * `credentialLoaded` y `credentialLast4`.
 *
 * `?q=` (nombre de empresa, host o etiqueta) y `?status=` filtran la LISTA;
 * el `summary` es siempre el de toda la instancia — si filtrar cambiara el
 * resumen, el semáforo dejaría de ser un semáforo.
 */
export const GET = withSuperAdmin(async (_ctx, req: Request) => {
  const filters = parseMcpConnectorFilters(new URL(req.url).searchParams);
  const view = await listMcpConnectors();
  return Response.json({
    summary: view.summary,
    filters,
    organizations: filterMcpConnectors(view.organizations, filters),
  });
});
