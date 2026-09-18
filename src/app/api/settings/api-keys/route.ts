import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  ApiKeyError,
  createApiKey,
  listApiKeys,
  serializeApiKey,
} from "@/server/api-keys/keys";

export const dynamic = "force-dynamic";

/**
 * Claves de API de la PROPIA empresa (014, contrato api.md § API interna):
 * GET para cualquier miembro (lista sin secretos); POST solo `owner`. El
 * secreto se devuelve UNA vez, en el 201 del alta.
 */
export const GET = withAuth(async (session) => {
  const keys = await listApiKeys(session.organizationId);
  return Response.json({
    keys: keys.map(serializeApiKey),
    canManage: session.role === "owner",
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede crear claves de API");
  }
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  try {
    const { row, secret } = await createApiKey({
      organizationId: session.organizationId,
      name: body.data.name,
      createdBy: session.userId,
    });
    return Response.json({ key: serializeApiKey(row), secret }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return apiError(err.code === "limit" ? 409 : 404, err.code, err.message);
    }
    throw err;
  }
});
