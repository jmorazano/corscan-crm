import { apiError, parseBody, withAuth } from "@/lib/api";
import { isGoogleIntegrationConfigured } from "@/lib/env";
import { GoogleAuthError } from "@/lib/google/oauth";
import { GoogleApiError } from "@/lib/google/calendar-client";
import {
  disconnectCalendarIntegration,
  getCalendarIntegrationView,
  listCalendars,
  updateCalendarIntegration,
} from "@/server/calendar/integration";
import { calendarRulesPatchSchema } from "@/server/calendar/rules";

export const dynamic = "force-dynamic";

/**
 * Integración Google Calendar de la PROPIA empresa (contrato
 * integrations-api.md): GET para cualquier miembro; PUT/DELETE solo
 * `owner` (FR-002). Tokens jamás en la respuesta (FR-004).
 */

export const GET = withAuth(async (session) => {
  const integration = await getCalendarIntegrationView(session.organizationId);
  return Response.json({
    available: isGoogleIntegrationConfigured(),
    integration,
    canManage: session.role === "owner",
  });
});

export const PUT = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede editar la integración");
  }
  const body = await parseBody(req, calendarRulesPatchSchema);
  if (!body.ok) return body.response;

  const { calendarId, ...rules } = body.data;
  let calendarName: string | null | undefined;
  if (calendarId !== undefined) {
    // Se resuelve contra la lista real para guardar el nombre (y validar
    // que la cuenta conectada realmente ve ese calendario).
    try {
      const calendars = await listCalendars(session.organizationId);
      const found = calendars.find((c) => c.id === calendarId);
      if (!found) {
        return apiError(422, "invalid_body", "El calendario elegido no existe en la cuenta conectada");
      }
      calendarName = found.summary;
    } catch (err) {
      if (err instanceof GoogleAuthError && err.code === "not_configured") {
        return apiError(404, "not_connected", "Google Calendar no está conectado");
      }
      if (err instanceof GoogleAuthError || err instanceof GoogleApiError) {
        return apiError(502, "provider_error", "No se pudo consultar los calendarios de Google");
      }
      throw err;
    }
  }
  const ok = await updateCalendarIntegration(session.organizationId, {
    ...rules,
    ...(calendarId !== undefined ? { calendarId, calendarName: calendarName ?? null } : {}),
  });
  if (!ok) return apiError(404, "not_connected", "Google Calendar no está conectado");
  return Response.json({ ok: true });
});

export const DELETE = withAuth(async (session) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede desconectar la integración");
  }
  await disconnectCalendarIntegration(session.organizationId);
  return Response.json({ ok: true });
});
