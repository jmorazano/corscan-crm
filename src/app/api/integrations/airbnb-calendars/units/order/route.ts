import { parseBody, withOwner } from "@/lib/api";
import { unitOrderSchema } from "@/lib/ical/input";
import { reorderUnits } from "@/server/ical/integration";

export const dynamic = "force-dynamic";

/** Orden de las unidades (051): el agente las nombra en este orden. */
export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, unitOrderSchema);
  if (!body.ok) return body.response;
  await reorderUnits(session.organizationId, body.data.ids);
  return Response.json({ ok: true });
});
