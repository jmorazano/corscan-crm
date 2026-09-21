import { apiError, withAuth } from "@/lib/api";
import { mcpErrorText } from "@/lib/mcp";
import { handshakeGuarded } from "@/server/mcp/calls";
import { refreshCatalog } from "@/server/mcp/catalog";
import { getMcpIntegrationView } from "@/server/mcp/integration";

export const dynamic = "force-dynamic";

/**
 * Handshake EN VIVO del conector (016, contrato `mcp-integration-api.md`).
 * Body vacío: todo lo que hace falta está en la fila.
 *
 * Orden de efectos: sintaxis + resolución guardada (anti-SSRF sobre la IP
 * resuelta, FR-003) → `initialize` → `tools/list` → `requiredTools` del
 * perfil → prefetch del catálogo → `status='connected'`.
 *
 * Va por `handshakeGuarded` y NO por `handshake` a secas: es el cupo propio
 * de 6 por minuto por empresa (corrección #16), sin el cual «`calls.ts` es el
 * único lugar que llama al MCP» era falso.
 *
 * Todo mensaje que sale de acá viene de `MCP_ERROR_TEXT` (FR-016, corrección
 * #13): ni un byte del cuerpo remoto. `mcpCode` es el código estable para que
 * la UI elija el banner.
 */
export const POST = withAuth(async (session) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede verificar el conector");
  }

  const result = await handshakeGuarded(session.organizationId);

  if (result.ok) {
    // Prefetch del catálogo: sin él la tarjeta queda "conectada" pero vacía
    // y el prompt del agente sin listas reales. Nunca lanza y nunca deja la
    // fila peor de lo que estaba.
    await refreshCatalog(session.organizationId).catch(() => undefined);
    const integration =
      (await getMcpIntegrationView(session.organizationId)) ?? result.integration;
    return Response.json({ ok: true, integration });
  }

  // El cupo se distingue por la forma, no por el código: `rate_limited` es
  // además un `McpErrorCode` válido, así que mirar `code` no alcanza.
  if ("retryInSeconds" in result) {
    return apiError(429, "rate_limited", mcpErrorText("rate_limited"), {
      retryInSeconds: result.retryInSeconds,
    });
  }
  if (result.code === "not_enabled") {
    return apiError(404, "not_enabled", "Esta empresa no tiene el conector habilitado");
  }
  if (result.code === "no_credential") {
    return apiError(409, "no_credential", "Cargá la credencial antes de verificar");
  }

  // Caso especial: el servidor no expone alguna de `profile.requiredTools`.
  // Los nombres que viajan son los de NUESTRA lista, nunca texto del remoto.
  const missing = result.missingTools ?? [];
  return apiError(
    502,
    "provider_error",
    mcpErrorText(result.code),
    missing.length > 0
      ? { mcpCode: result.code, missingTools: missing }
      : { mcpCode: result.code }
  );
});
