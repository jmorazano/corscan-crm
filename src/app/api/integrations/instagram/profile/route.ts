import { withOwner } from "@/lib/api";
import { messagingProfileInput } from "@/lib/instagram/profile";
import { instagramConfigErrorResponse, validationError } from "@/server/instagram/api-errors";
import { saveMessagingProfile } from "@/server/instagram/profile";

export const dynamic = "force-dynamic";

/**
 * 030 (US4): preguntas frecuentes y menú fijo. Guarda y aplica en Instagram;
 * si Meta falla, lo guardado queda y la respuesta trae el motivo.
 */
export const PUT = withOwner(async (session, req: Request) => {
  const parsed = messagingProfileInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues);
  try {
    const res = await saveMessagingProfile(session.organizationId, parsed.data);
    return Response.json(res, { status: res.synced ? 200 : 502 });
  } catch (err) {
    return instagramConfigErrorResponse(err);
  }
});
