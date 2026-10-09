import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { deleteSource, refreshSource, updateSource } from "@/server/sheets/sources";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean().optional(),
});

export const PATCH = withOwner(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const source = await updateSource(session.organizationId, id, body.data);
  if (!source) return apiError(404, "not_found", "Planilla inexistente");
  return Response.json(source);
});

export const DELETE = withOwner(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  if (!(await deleteSource(session.organizationId, id))) {
    return apiError(404, "not_found", "Planilla inexistente");
  }
  return Response.json({ ok: true });
});

/** POST = «Actualizar ahora». */
export const POST = withOwner(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const source = await refreshSource(session.organizationId, id);
  if (!source) return apiError(404, "not_found", "Planilla inexistente");
  return Response.json(source);
});
