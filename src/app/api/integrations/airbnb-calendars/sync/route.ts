import { apiError, withOwner } from "@/lib/api";
import { syncOrganizationNow } from "@/server/ical/sync";

export const dynamic = "force-dynamic";

/** «Leer ahora» (051): todas las unidades, de a una; una vez por minuto. */
export const POST = withOwner(async (session) => {
  const res = await syncOrganizationNow(session.organizationId);
  if (!res.ok) {
    return apiError(429, "cooldown", "Recién se leyeron los calendarios: probá de nuevo en un minuto.", {
      retryInMs: res.retryInMs,
    });
  }
  return Response.json({ ok: true, results: res.results });
});
