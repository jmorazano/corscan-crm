import { withOwner } from "@/lib/api";
import { instagramConfigErrorResponse } from "@/server/instagram/api-errors";
import { listRecentMedia } from "@/server/instagram/profile";

export const dynamic = "force-dynamic";

/**
 * 030: las publicaciones de la cuenta, de a 24 (más nuevas primero), para
 * elegir en una regla. `?after=` = cursor de la página siguiente.
 */
export const GET = withOwner(async (session, req: Request) => {
  const after = new URL(req.url).searchParams.get("after")?.slice(0, 512) || null;
  try {
    return Response.json(await listRecentMedia(session.organizationId, after));
  } catch (err) {
    return instagramConfigErrorResponse(err);
  }
});
