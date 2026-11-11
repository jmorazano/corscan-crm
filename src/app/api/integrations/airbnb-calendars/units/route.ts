import { parseBody, withOwner } from "@/lib/api";
import { unitCreateSchema } from "@/lib/ical/input";
import { createUnit } from "@/server/ical/integration";
import { unitFailureResponse } from "@/server/ical/http";

export const dynamic = "force-dynamic";

/** Alta de una unidad (051): valida el enlace y lee el calendario antes de guardar. */
export const POST = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, unitCreateSchema);
  if (!body.ok) return body.response;
  const res = await createUnit(session.organizationId, body.data);
  if (!res.ok) return unitFailureResponse(res);
  return Response.json({ unit: res.unit }, { status: 201 });
});
