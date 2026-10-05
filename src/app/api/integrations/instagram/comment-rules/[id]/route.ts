import { z } from "zod";
import { withOwner } from "@/lib/api";
import { commentRuleInput } from "@/lib/instagram/comments";
import { instagramConfigErrorResponse, validationError } from "@/server/instagram/api-errors";
import { deleteCommentRule, setCommentRuleActive, updateCommentRule } from "@/server/instagram/profile";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const toggle = z.object({ active: z.boolean() }).strict();

/** 030: edita una regla completa, o solo la prende/apaga (`{active}`). */
export const PATCH = withOwner(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  try {
    const onlyToggle = toggle.safeParse(body);
    if (onlyToggle.success) {
      await setCommentRuleActive(session.organizationId, id, onlyToggle.data.active);
      return Response.json({ ok: true });
    }
    const parsed = commentRuleInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error.issues);
    await updateCommentRule(session.organizationId, id, parsed.data);
    return Response.json({ ok: true });
  } catch (err) {
    return instagramConfigErrorResponse(err);
  }
});

export const DELETE = withOwner(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  await deleteCommentRule(session.organizationId, id);
  return Response.json({ ok: true });
});
