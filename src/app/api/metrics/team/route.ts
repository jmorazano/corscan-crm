import { apiError, withOwner } from "@/lib/api";
import { parseMetricsQuery } from "@/lib/metrics";
import { getTeamAttention } from "@/server/metrics/team";

export const dynamic = "force-dynamic";

/**
 * 048: la sección «Equipo» de Métricas — esperas, quién respondió y cuánto
 * tardó, y el estado de los avisos de cada persona. Solo del propietario
 * (un miembro ve su fila en `/api/me/attention`). Mismos parámetros que
 * `/api/metrics`.
 */
export const GET = withOwner(async (session, req: Request) => {
  const parsed = parseMetricsQuery(new URL(req.url).searchParams);
  if (!parsed.ok) {
    return apiError(400, "invalid_range", "El período debe ser day, week o year");
  }
  return Response.json(await getTeamAttention(session.organizationId, parsed.range, parsed.timeZone));
});
