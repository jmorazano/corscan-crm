import { parseBody, withOwner } from "@/lib/api";
import { unitUpdateSchema } from "@/lib/ical/input";
import { deleteUnit, updateUnit } from "@/server/ical/integration";
import { unitFailureResponse } from "@/server/ical/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Edita una unidad (051). Enlace vacío = se conserva el guardado. */
export const PATCH = withOwner(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, unitUpdateSchema);
  if (!body.ok) return body.response;
  const res = await updateUnit(session.organizationId, id, body.data);
  if (!res.ok) return unitFailureResponse(res);
  return Response.json({ unit: res.unit });
});

export const DELETE = withOwner(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const deleted = await deleteUnit(session.organizationId, id);
  if (!deleted) return unitFailureResponse({ ok: false, reason: "not_found", message: "La unidad no existe." });
  return Response.json({ ok: true });
});
