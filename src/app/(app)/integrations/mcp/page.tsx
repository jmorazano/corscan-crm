import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { McpClient } from "@/components/integrations/mcp-client";
import { getSessionOrNull } from "@/lib/auth/session";
import { getMcpIntegrationView } from "@/server/mcp/integration";

export const dynamic = "force-dynamic";

/**
 * Detalle del conector MCP de la empresa (016, FR-001).
 *
 * Segunda de las tres capas de defensa: sin fila `mcp_integration` la ruta
 * NO existe (404 de Next), no es una tarjeta escondida por CSS. La primera
 * capa es el índice (`GET /api/integrations` no trae el ítem) y la tercera —
 * la que de verdad protege — es el `404 not_enabled` de cada endpoint.
 */
export default async function McpIntegrationPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const view = await getMcpIntegrationView(session.organizationId);
  if (!view) notFound();

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 md:px-6 md:py-4">
        <p className="text-xs text-muted-foreground">
          <Link href="/integrations" className="hover:underline">
            Integraciones
          </Link>{" "}
          / {view.label}
        </p>
        <h2 className="font-semibold">{view.label}</h2>
        <p className="text-sm text-muted-foreground">
          El agente consulta disponibilidad, precios y enlaces reales en el
          sistema de reservas del negocio. Informa y pasa el enlace: nunca
          confirma ni promete una reserva.
        </p>
      </header>
      <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        <McpClient />
      </div>
    </div>
  );
}
