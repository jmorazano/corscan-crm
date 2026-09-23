import { apiError, withSuperAdmin } from "@/lib/api";
import { removeOrganizationUser } from "@/server/admin/users";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; userId: string }> };

/**
 * Quitar un usuario de una empresa (019, FR-004). 404 si la empresa o la
 * cuenta no existen o no es miembro; 409 `last_owner`; 403 super admin
 * ajeno. Si la cuenta queda sin empresas se elimina (`accountDeleted`).
 */
export const DELETE = withSuperAdmin(
  async (ctx, _req: Request, routeCtx: Params) => {
    const { id, userId } = await routeCtx.params;
    const result = await removeOrganizationUser({
      organizationId: id,
      userId,
      operatorEmail: ctx.email,
    });
    if (!result.ok) {
      const status =
        result.code === "last_owner"
          ? 409
          : result.code === "forbidden"
            ? 403
            : 404;
      return apiError(status, result.code, result.message);
    }
    return Response.json({ ok: true, accountDeleted: result.accountDeleted });
  }
);
