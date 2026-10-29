import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { resetTeamMemberPassword, teamErrorStatus } from "@/server/team";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userId: string }> };

const resetSchema = z.object({
  // Min 8 server-side (D7): jamás se confía en el generador del cliente.
  password: z.string().min(8).max(128),
});

/**
 * 045: el propietario genera una contraseña temporal nueva para alguien
 * del equipo. Debe cambiarla al entrar; sus sesiones se cierran. 409
 * `shared_account` si la cuenta también usa otras empresas.
 */
export const POST = withOwner(async (session, req: Request, ctx: Params) => {
  const { userId } = await ctx.params;
  const body = await parseBody(req, resetSchema);
  if (!body.ok) return body.response;
  const result = await resetTeamMemberPassword(session, userId, body.data.password);
  if (!result.ok) {
    return apiError(teamErrorStatus(result.code), result.code, result.message);
  }
  return Response.json({ ok: true });
});
