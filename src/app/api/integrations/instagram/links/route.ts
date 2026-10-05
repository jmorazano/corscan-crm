import { withOwner } from "@/lib/api";
import { entryLinkInput } from "@/lib/instagram/entry-links";
import { instagramConfigErrorResponse, validationError } from "@/server/instagram/api-errors";
import { createEntryLink } from "@/server/instagram/profile";

export const dynamic = "force-dynamic";

/** 030 (US5): crea un link con origen (`ig.me/<cuenta>?ref=<slug>`). */
export const POST = withOwner(async (session, req: Request) => {
  const parsed = entryLinkInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);
  try {
    const id = await createEntryLink(session.organizationId, parsed.data);
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    return instagramConfigErrorResponse(err);
  }
});
