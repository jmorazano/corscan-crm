import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_JUDGE_MODEL,
  deleteAiConfig,
  getAiSettings,
  saveAiConfig,
  tokenLast4,
} from "@/server/ai/credentials";

export const dynamic = "force-dynamic";

/**
 * Config de IA de la PROPIA empresa (contrato ai-settings.md): GET para
 * cualquier miembro; PUT/DELETE solo `owner` (mismo criterio que Equipo).
 * El token completo JAMÁS se devuelve — solo sus últimos 4.
 */

export const GET = withAuth(async (session) => {
  const settings = await getAiSettings(session.organizationId);
  return Response.json({
    config: settings
      ? {
          configured: true,
          tokenLast4: settings.tokenLast4,
          model: settings.model,
          judgeModel: settings.judgeModel,
        }
      : null,
    defaults: { model: DEFAULT_AGENT_MODEL, judgeModel: DEFAULT_JUDGE_MODEL },
  });
});

const putSchema = z.object({
  // Token vacío → 422 (contrato); el formato no se valida contra el
  // proveedor: el primer turno del agente valida en la práctica (FR-010).
  token: z.string().trim().min(1).max(512),
  model: z.string().trim().min(1).max(200).optional(),
  judgeModel: z.string().trim().min(1).max(200).optional(),
});

export const PUT = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(
      403,
      "forbidden",
      "Solo el propietario puede configurar la IA"
    );
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  await saveAiConfig({
    organizationId: session.organizationId,
    token: body.data.token,
    model: body.data.model ?? null,
    judgeModel: body.data.judgeModel ?? null,
  });
  return Response.json({ ok: true, tokenLast4: tokenLast4(body.data.token) });
});

/** Apaga la IA de la empresa. Idempotente: 200 aunque no hubiera config. */
export const DELETE = withAuth(async (session) => {
  if (session.role !== "owner") {
    return apiError(
      403,
      "forbidden",
      "Solo el propietario puede borrar la config de IA"
    );
  }
  await deleteAiConfig(session.organizationId);
  return Response.json({ ok: true });
});
