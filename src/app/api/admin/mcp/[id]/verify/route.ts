import { apiError, withSuperAdmin } from "@/lib/api";
import { mcpErrorText } from "@/lib/mcp";
import { getMcpConnectorDetail } from "@/server/mcp/admin";
import { handshakeGuarded } from "@/server/mcp/calls";
import { refreshCatalog } from "@/server/mcp/catalog";

export const dynamic = "force-dynamic";

/**
 * Handshake EN VIVO de CUALQUIER empresa, disparado por el super admin
 * (016, contrato `admin-mcp-api.md`).
 *
 * Esto es lo que convierte el panel en «gestión» y no en «lectura»: hasta
 * acá, para saber si el conector de un cliente seguía vivo había que entrar
 * como ese cliente. El `POST /api/integrations/mcp/verify` del `owner` sigue
 * existiendo y no cambia; este es el mismo efecto desde Administración.
 *
 * Va por `handshakeGuarded` y NO por `handshake` a secas: mismo cupo de 6 por
 * minuto POR EMPRESA (corrección #16), que es lo que sostiene que `calls.ts`
 * sea el único lugar del repo que llama a un servidor MCP. El cupo es por
 * empresa, así que el super admin no puede usar esta ruta para saltárselo.
 *
 * No toca la credencial ni la muestra: el handshake la descifra adentro de
 * `integration.ts` y de ahí no sale. Lo que vuelve es el conector ACTUALIZADO
 * (estado, `serverInfo`, herramientas, `lastError*`), listo para repintar la
 * fila sin un GET extra.
 *
 * Todo mensaje que sale de acá viene de `MCP_ERROR_TEXT` (FR-016, corrección
 * #13); `mcpCode` es el código estable para que la UI elija el banner.
 */
type Params = { params: Promise<{ id: string }> };

export const POST = withSuperAdmin(async (_ctx, _req: Request, routeCtx: Params) => {
  const { id } = await routeCtx.params;

  // 404 honesto antes de tocar la red: sin esto, un id inventado se
  // confundiría con «esa empresa no tiene el conector habilitado».
  const before = await getMcpConnectorDetail(id);
  if (!before) {
    return apiError(404, "organization_not_found", "La empresa no existe");
  }

  const result = await handshakeGuarded(id);

  if (result.ok) {
    // Prefetch del catálogo, igual que en la verificación del `owner`: sin él
    // la fila queda «conectada» pero vacía y el prompt del agente sin listas
    // reales. Nunca lanza y nunca deja la fila peor de lo que estaba.
    await refreshCatalog(id).catch(() => undefined);
    const organization = (await getMcpConnectorDetail(id)) ?? before;
    return Response.json({ ok: true, organization });
  }

  // El cupo se distingue por la FORMA, no por el código: `rate_limited` es
  // además un `McpErrorCode` válido, así que mirar `code` no alcanza.
  if ("retryInSeconds" in result) {
    return apiError(429, "rate_limited", mcpErrorText("rate_limited"), {
      retryInSeconds: result.retryInSeconds,
    });
  }
  if (result.code === "not_enabled") {
    return apiError(409, "not_enabled", "Esta empresa no tiene el conector habilitado");
  }
  if (result.code === "no_credential") {
    return apiError(
      409,
      "no_credential",
      "La empresa todavía no cargó la credencial del proveedor"
    );
  }

  // El fallo también es información: la fila ya quedó con `lastErrorCode` y
  // `lastErrorAt`, así que se devuelve el conector actualizado junto al error.
  const missing = result.missingTools ?? [];
  const organization = (await getMcpConnectorDetail(id)) ?? before;
  return apiError(502, "provider_error", mcpErrorText(result.code), {
    mcpCode: result.code,
    ...(missing.length > 0 ? { missingTools: missing } : {}),
    organization,
  });
});
