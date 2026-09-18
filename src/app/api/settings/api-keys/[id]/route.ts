import { apiError, withAuth } from "@/lib/api";
import { ApiKeyError, revokeApiKey, serializeApiKey } from "@/server/api-keys/keys";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Revocación (014, FR-001): solo `owner`; idempotente. */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede revocar claves de API");
  }
  const { id } = await ctx.params;
  try {
    const row = await revokeApiKey(session.organizationId, id);
    return Response.json({ ok: true, key: serializeApiKey(row) });
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return apiError(404, "not_found", err.message);
    }
    throw err;
  }
});
