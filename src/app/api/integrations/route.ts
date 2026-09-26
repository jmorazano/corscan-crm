import { withAuth } from "@/lib/api";
import { isGoogleIntegrationConfigured, isInstagramConfigured } from "@/lib/env";
import { getInstagramIntegrationView } from "@/server/instagram/integration";
import { getCalendarIntegrationView } from "@/server/calendar/integration";
import { getMcpIntegrationView } from "@/server/mcp/integration";

export const dynamic = "force-dynamic";

/**
 * Índice de integraciones (contrato integrations-api.md, FR-001): estado
 * por integración soportada. Hoy: Google Calendar. Sin tokens, jamás.
 */
export const GET = withAuth(async (session) => {
  const [gc, mcp, ig] = await Promise.all([
    getCalendarIntegrationView(session.organizationId),
    getMcpIntegrationView(session.organizationId),
    getInstagramIntegrationView(session.organizationId),
  ]);
  return Response.json({
    integrations: [
      {
        key: "google_calendar",
        name: "Google Calendar",
        available: isGoogleIntegrationConfigured(),
        connected: gc !== null,
        status: gc?.status ?? null,
        accountEmail: gc?.accountEmail ?? null,
      },
      // 023: canal de mensajería; la cuenta se muestra como @usuario.
      {
        key: "instagram",
        name: "Instagram Direct",
        available: isInstagramConfigured(),
        connected: ig !== null,
        status: ig?.status ?? null,
        accountEmail: ig?.username ? `@${ig.username}` : null,
      },
      // 016 (FR-001): a diferencia de Google Calendar, esta tarjeta NO la ven
      // todas las empresas. La habilita el super admin empresa por empresa, y
      // la existencia de la fila ES la habilitación: sin fila, la tarjeta
      // simplemente no está en la lista. La URL completa jamás sale de acá.
      ...(mcp
        ? [
            {
              key: "mcp",
              name: mcp.label,
              available: true,
              connected: mcp.status === "connected",
              status: mcp.status,
              accountEmail: null,
              endpointHost: mcp.endpointHost,
            },
          ]
        : []),
    ],
  });
});
