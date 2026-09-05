import { z } from "zod";
import { apiError, parseBody, withSuperAdmin } from "@/lib/api";
import { resetUserPassword } from "@/server/admin/users";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const resetSchema = z.object({
  // Min 8 server-side (D7): jamás se confía en el generador del cliente.
  password: z.string().min(8).max(128),
});

/**
 * Reset de contraseña por el super admin (contrato admin-api.md,
 * FR-014/FR-017): temporal nueva sin conocer la vieja, must_change_password
 * y sesiones del usuario invalidadas. 403 sobre super admins ajenos.
 */
export const POST = withSuperAdmin(
  async (ctx, req: Request, routeCtx: Params) => {
    const { id } = await routeCtx.params;
    const body = await parseBody(req, resetSchema);
    if (!body.ok) return body.response;

    const result = await resetUserPassword({
      userId: id,
      password: body.data.password,
      operatorEmail: ctx.email,
    });
    if (!result.ok) {
      return apiError(
        result.code === "not_found" ? 404 : 403,
        result.code,
        result.message
      );
    }
    return Response.json({ ok: true });
  }
);
