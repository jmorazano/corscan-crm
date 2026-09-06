import { apiError, withAuth } from "@/lib/api";
import { cancelAppointment } from "@/server/calendar/booking";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Cancela un turno (FR-015): borra el evento y marca cancelado (monotónico). */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const result = await cancelAppointment(session.organizationId, id);
  if (result === "not_found") {
    return apiError(404, "not_found", "Turno inexistente o ya cancelado");
  }
  return Response.json({ ok: true });
});
