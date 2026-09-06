import { withAuth } from "@/lib/api";
import { listAppointments } from "@/server/calendar/booking";

export const dynamic = "force-dynamic";

/** Próximos turnos agendados desde el CRM (FR-015). */
export const GET = withAuth(async (session) => {
  const appointments = await listAppointments(session.organizationId);
  return Response.json({ appointments });
});
