import { apiError, parseBody, withOwner } from "@/lib/api";
import {
  deleteEntry,
  KbError,
  kbPatchSchema,
  updateEntry,
} from "@/server/kb/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const KB_ERROR_STATUS: Record<KbError["code"], number> = {
  not_found: 404,
  kind_mismatch: 422,
  invalid: 422,
};

export const PATCH = withOwner(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, kbPatchSchema);
  if (!body.ok) return body.response;
  try {
    const { after } = await updateEntry(session.organizationId, id, body.data);
    return Response.json({ entry: after });
  } catch (err) {
    if (err instanceof KbError) {
      return apiError(KB_ERROR_STATUS[err.code], err.code, err.message);
    }
    throw err;
  }
});

export const DELETE = withOwner(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  try {
    await deleteEntry(session.organizationId, id);
    return Response.json({ deleted: true });
  } catch (err) {
    if (err instanceof KbError) {
      return apiError(KB_ERROR_STATUS[err.code], err.code, err.message);
    }
    throw err;
  }
});
