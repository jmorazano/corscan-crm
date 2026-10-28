import { z } from "zod";
import { parseBody, withAuth, withOwner } from "@/lib/api";
import { canManageConfig } from "@/lib/roles";
import { STALE_DAYS_OPTIONS } from "@/lib/lead-stages";
import { countStaleLeads, getStaleDays, setStaleDays, sweepStaleLeads } from "@/server/inbox/lead-stale";

export const dynamic = "force-dynamic";

/**
 * 044: ajustes del pipeline. Hoy, «pasar a perdido tras N días sin
 * respuesta». La lectura trae la vista previa (cuántos leads pasarían HOY con
 * cada opción) para que prenderla no sea una sorpresa; lo cambia solo el
 * propietario.
 */
export const GET = withAuth(async (session) => {
  const staleLostDays = await getStaleDays(session.organizationId);
  const now = new Date();
  const preview = Object.fromEntries(
    await Promise.all(
      STALE_DAYS_OPTIONS.map(async (d) => [d, await countStaleLeads(session.organizationId, d, now)] as const)
    )
  );
  return Response.json({
    staleLostDays,
    options: STALE_DAYS_OPTIONS,
    preview,
    canEdit: canManageConfig(session.role),
  });
});

const putSchema = z.object({
  staleLostDays: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(60), z.null()]),
});

export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const days = body.data.staleLostDays;
  await setStaleDays(session.organizationId, days);
  // Se aplica en el acto: lo que mostró la vista previa es lo que pasa.
  const moved = days ? await sweepStaleLeads(session.organizationId, days) : 0;
  return Response.json({ staleLostDays: days, moved });
});
