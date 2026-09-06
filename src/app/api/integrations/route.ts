import { withAuth } from "@/lib/api";
import { isGoogleIntegrationConfigured } from "@/lib/env";
import { getCalendarIntegrationView } from "@/server/calendar/integration";

export const dynamic = "force-dynamic";

/**
 * Índice de integraciones (contrato integrations-api.md, FR-001): estado
 * por integración soportada. Hoy: Google Calendar. Sin tokens, jamás.
 */
export const GET = withAuth(async (session) => {
  const gc = await getCalendarIntegrationView(session.organizationId);
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
    ],
  });
});
