import { apiError, withSuperAdmin } from "@/lib/api";
import { getOrganization } from "@/server/admin/organizations";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 019: detalle de una empresa para Administración (mismo DTO que el listado). */
export const GET = withSuperAdmin(
  async (_ctx, _req: Request, routeCtx: Params) => {
    const { id } = await routeCtx.params;
    const organization = await getOrganization(id);
    if (!organization) {
      return apiError(404, "not_found", "La empresa no existe");
    }
    return Response.json({ organization });
  }
);
