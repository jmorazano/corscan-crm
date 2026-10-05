import { z } from "zod";
import { apiError, withOwner } from "@/lib/api";
import { setInstagramCommentHidden } from "@/server/instagram/comments";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ commentId: string }> };

/** 030: ocultar / mostrar un comentario desde la actividad. */
export const PATCH = withOwner(async (session, req: Request, ctx: Params) => {
  const { commentId } = await ctx.params;
  const parsed = z.object({ hidden: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(422, "invalid", "Falta `hidden`");
  const res = await setInstagramCommentHidden(session.organizationId, commentId, parsed.data.hidden);
  if (!res.ok) return apiError(409, "meta_error", res.message);
  return Response.json({ ok: true });
});
