import { withOwner } from "@/lib/api";
import { instagramConfigErrorResponse } from "@/server/instagram/api-errors";
import { listRecentMedia } from "@/server/instagram/profile";

export const dynamic = "force-dynamic";

/** 030: las últimas publicaciones de la cuenta, para elegir en una regla. */
export const GET = withOwner(async (session) => {
  try {
    return Response.json({ media: await listRecentMedia(session.organizationId) });
  } catch (err) {
    return instagramConfigErrorResponse(err);
  }
});
