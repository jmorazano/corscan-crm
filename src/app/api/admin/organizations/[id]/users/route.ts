import { z } from "zod";
import { apiError, parseBody, withSuperAdmin } from "@/lib/api";
import { createOrganizationUser } from "@/server/admin/users";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  // Min 8 server-side (D7): jamás se confía en el generador del cliente.
  password: z.string().min(8).max(128),
  role: z.enum(["owner", "member"]),
});

/** Usuario adicional en una empresa (contrato admin-api.md, FR-014). */
export const POST = withSuperAdmin(
  async (_ctx, req: Request, routeCtx: Params) => {
    const { id } = await routeCtx.params;
    const body = await parseBody(req, createSchema);
    if (!body.ok) return body.response;

    const result = await createOrganizationUser({
      organizationId: id,
      ...body.data,
    });
    if (!result.ok) {
      const status =
        result.code === "not_found"
          ? 404
          : result.code === "duplicate_email"
            ? 409
            : result.code === "reserved_email"
              ? 403
              : 422;
      return apiError(status, result.code, result.message);
    }
    return Response.json({ ok: true }, { status: 201 });
  }
);
