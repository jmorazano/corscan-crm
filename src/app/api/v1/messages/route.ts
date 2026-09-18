import { z } from "zod";
import { apiError, parseBody, withApiKey } from "@/lib/api";
import { IDEMPOTENCY_KEY_MAX } from "@/lib/idempotency";
import { sendViaApi } from "@/server/public-api/send";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  to: z.string().trim().min(5).max(40),
  name: z.string().trim().max(120).optional(),
  template: z.string().trim().min(1).max(512),
  language: z.string().trim().min(2).max(10).optional(),
  // Índices como claves ("1".."5"); la validación semántica vive en
  // resolveApiParams (faltantes/sobrantes/regla de Meta).
  params: z
    .record(z.string().regex(/^[1-5]$/, "índice 1..5"), z.string().max(2000))
    .optional()
    .default({}),
});

/**
 * API pública (014, FR-004): envía una plantilla aprobada a un teléfono.
 * `Idempotency-Key` opcional pero recomendada: a lo sumo UN envío por
 * (empresa, clave); repetición → misma respuesta + `Idempotent-Replayed`.
 */
export const POST = withApiKey(async (ctx, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const rawKey = req.headers.get("idempotency-key")?.trim() || null;
  if (rawKey && rawKey.length > IDEMPOTENCY_KEY_MAX) {
    return apiError(
      422,
      "invalid_body",
      `Idempotency-Key: máximo ${IDEMPOTENCY_KEY_MAX} caracteres`
    );
  }

  const result = await sendViaApi({
    organizationId: ctx.organizationId,
    apiKey: { id: ctx.apiKeyId, name: ctx.apiKeyName },
    body: body.data,
    idempotencyKey: rawKey,
  });
  return Response.json(result.body, { status: result.status, headers: result.headers });
});
