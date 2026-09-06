import { apiError, withAuth } from "@/lib/api";
import { GoogleAuthError } from "@/lib/google/oauth";
import { GoogleApiError } from "@/lib/google/calendar-client";
import { localDateTimeKey, parseDateKey } from "@/lib/time";
import { getAvailability } from "@/server/calendar/availability";
import { getCalendarIntegration } from "@/server/calendar/integration";

export const dynamic = "force-dynamic";

/**
 * Vista previa de huecos libres (FR-009) con las reglas vigentes y la
 * agenda real. `?from=YYYY-MM-DD&days=7`. Solo huecos: jamás eventos.
 */
export const GET = withAuth(async (session, req: Request) => {
  const integration = await getCalendarIntegration(session.organizationId);
  if (!integration) return apiError(404, "not_connected", "Google Calendar no está conectado");
  if (integration.status === "reconnect_required") {
    return apiError(502, "provider_error", "La integración requiere reconexión");
  }
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  if (from && !parseDateKey(from)) return apiError(422, "invalid_body", "from debe ser YYYY-MM-DD");
  const daysRaw = Number(url.searchParams.get("days") ?? "7");
  const days = Number.isInteger(daysRaw) ? Math.min(Math.max(daysRaw, 1), integration.rules.horizonDays) : 7;
  try {
    const { slots, timezone, source } = await getAvailability(integration, {
      fromDate: from,
      days,
      limit: 200,
    });
    return Response.json({
      timezone,
      source,
      slots: slots.map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        local: localDateTimeKey(timezone, s.start),
        label: s.label,
      })),
    });
  } catch (err) {
    if (err instanceof GoogleAuthError || err instanceof GoogleApiError) {
      return apiError(
        502,
        "provider_error",
        err instanceof GoogleAuthError && err.code === "invalid_grant"
          ? "Google rechazó la credencial: reconectá la integración"
          : "No se pudo consultar la agenda de Google"
      );
    }
    throw err;
  }
});
