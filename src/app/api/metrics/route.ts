import { apiError, withOwner } from "@/lib/api";
import { parseMetricsQuery } from "@/lib/metrics";
import { getMetricsOverview } from "@/server/metrics/overview";

export const dynamic = "force-dynamic";

/**
 * Métricas de la empresa (024): tarjetas + serie del histograma en una
 * sola respuesta. Es una LECTURA, pero solo del propietario (spec 024): un
 * miembro recibe el mismo 403 `forbidden` que en la configuración.
 *
 * Query: `range=day|week|year` (default `day`) y `tz=<IANA>` del navegador.
 */
export const GET = withOwner(async (session, req: Request) => {
  const parsed = parseMetricsQuery(new URL(req.url).searchParams);
  if (!parsed.ok) {
    return apiError(400, "invalid_range", "El período debe ser day, week o year");
  }
  const overview = await getMetricsOverview(
    session.organizationId,
    parsed.range,
    parsed.timeZone
  );
  return Response.json(overview);
});
