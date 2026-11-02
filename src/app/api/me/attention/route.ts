import { apiError, withAuth } from "@/lib/api";
import { parseMetricsQuery } from "@/lib/metrics";
import { getMyAttention } from "@/server/metrics/team";

export const dynamic = "force-dynamic";

/**
 * 048: «Mi atención» — la fila de QUIEN PREGUNTA, nunca la de otra persona
 * (no acepta un usuario por parámetro). Todo el equipo la ve.
 */
export const GET = withAuth(async (session, req: Request) => {
  const parsed = parseMetricsQuery(new URL(req.url).searchParams);
  if (!parsed.ok) {
    return apiError(400, "invalid_range", "El período debe ser day, week o year");
  }
  return Response.json(
    await getMyAttention(session.organizationId, session.userId, parsed.range, parsed.timeZone)
  );
});
