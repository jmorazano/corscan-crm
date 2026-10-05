import { withOwner } from "@/lib/api";
import { commentRuleInput } from "@/lib/instagram/comments";
import { validationError } from "@/server/instagram/api-errors";
import { createCommentRule } from "@/server/instagram/profile";

export const dynamic = "force-dynamic";

/** 030: crea una regla de respuesta a comentarios. */
export const POST = withOwner(async (session, req: Request) => {
  const parsed = commentRuleInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);
  const id = await createCommentRule(session.organizationId, parsed.data);
  return Response.json({ id }, { status: 201 });
});
