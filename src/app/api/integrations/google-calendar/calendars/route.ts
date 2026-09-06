import { apiError, withAuth } from "@/lib/api";
import { GoogleAuthError } from "@/lib/google/oauth";
import { GoogleApiError } from "@/lib/google/calendar-client";
import { listCalendars } from "@/server/calendar/integration";

export const dynamic = "force-dynamic";

/** Calendarios reales de la cuenta conectada (para elegir destino, FR-006). */
export const GET = withAuth(async (session) => {
  try {
    const calendars = await listCalendars(session.organizationId);
    return Response.json({ calendars });
  } catch (err) {
    if (err instanceof GoogleAuthError && err.code === "not_configured") {
      return apiError(404, "not_connected", "Google Calendar no está conectado");
    }
    if (err instanceof GoogleAuthError || err instanceof GoogleApiError) {
      return apiError(
        502,
        "provider_error",
        err instanceof GoogleAuthError && err.code === "invalid_grant"
          ? "Google rechazó la credencial: reconectá la integración"
          : "No se pudo consultar los calendarios de Google"
      );
    }
    throw err;
  }
});
