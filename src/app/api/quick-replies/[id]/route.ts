import { parseBody, withAuth } from "@/lib/api";
import { quickReplyInput } from "@/lib/quick-replies";
import {
  deleteQuickReply,
  quickReplyError,
  serializeQuickReply,
  updateQuickReply,
} from "@/server/quick-replies";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Edita atajo y texto de una respuesta rápida (047). */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, quickReplyInput);
  if (!body.ok) return body.response;
  const result = await updateQuickReply(session.organizationId, id, body.data);
  if (!result.ok) return quickReplyError(result);
  return Response.json({ reply: serializeQuickReply(result.reply) });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const deleted = await deleteQuickReply(session.organizationId, id);
  if (!deleted) return quickReplyError({ ok: false, reason: "not_found" });
  return Response.json({ ok: true });
});
