import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getQuotaUsage } from "@/server/campaigns/quota";
import { resumePausedByQuota } from "@/server/campaigns/runner";

export const dynamic = "force-dynamic";

/**
 * Ajustes de envío por empresa (004, contrato settings-sending.md). El
 * límite es el FRENO del CRM, no el tier real de Meta: subirlo no cambia lo
 * que el canal permite.
 */
export const GET = withAuth(async (session) => {
  const usage = await getQuotaUsage(session.organizationId);
  return Response.json(usage);
});

const putSchema = z.object({
  dailyInitiatedLimit: z.number().int().min(1).max(100000),
});

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  await db
    .insert(schema.sendSettings)
    .values({
      id: newId("sendSettings"),
      organizationId: session.organizationId,
      dailyInitiatedLimit: body.data.dailyInitiatedLimit,
    })
    .onConflictDoUpdate({
      target: schema.sendSettings.organizationId,
      set: {
        dailyInitiatedLimit: body.data.dailyInitiatedLimit,
        updatedAt: new Date(),
      },
    });

  // Subir el límite libera cupo YA: reanudar las pausadas por daily_limit
  // sin esperar al ticker (jamás toca pausas manuales).
  void resumePausedByQuota(session.organizationId).catch(() => undefined);

  const usage = await getQuotaUsage(session.organizationId);
  return Response.json(usage);
});
