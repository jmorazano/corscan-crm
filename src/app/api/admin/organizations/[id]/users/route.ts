import { z } from "zod";
import { apiError, parseBody, withSuperAdmin } from "@/lib/api";
import { createOrganizationUser } from "@/server/admin/users";
import { attachExistingUser } from "@/server/auth/membership";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  // Min 8 server-side (D7): jamás se confía en el generador del cliente.
  password: z.string().min(8).max(128),
  role: z.enum(["owner", "member"]),
  attachExisting: z.literal(false).optional(),
});

/** 018: sumar una cuenta existente (sin nombre ni contraseña). */
const attachSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["owner", "member"]),
  attachExisting: z.literal(true),
});

const bodySchema = z.union([attachSchema, createSchema]);

/**
 * Usuario adicional en una empresa (contrato admin-api.md, FR-014) o, con
 * `attachExisting: true`, sumar una cuenta que ya existe (018, FR-008).
 */
export const POST = withSuperAdmin(
  async (_ctx, req: Request, routeCtx: Params) => {
    const { id } = await routeCtx.params;
    const body = await parseBody(req, bodySchema);
    if (!body.ok) return body.response;

    if (body.data.attachExisting === true) {
      const attached = await attachExistingUser({
        organizationId: id,
        email: body.data.email,
        role: body.data.role,
      });
      if (!attached.ok) {
        const status =
          attached.code === "not_found" || attached.code === "user_not_found"
            ? 404
            : attached.code === "already_member"
              ? 409
              : 403;
        return apiError(status, attached.code, attached.message);
      }
      return Response.json({ ok: true, userId: attached.userId, attached: true });
    }

    const result = await createOrganizationUser({
      organizationId: id,
      name: body.data.name,
      email: body.data.email,
      password: body.data.password,
      role: body.data.role,
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
      return apiError(
        status,
        result.code,
        result.message,
        result.code === "duplicate_email"
          ? { canAttach: result.canAttach === true }
          : undefined
      );
    }
    return Response.json({ ok: true }, { status: 201 });
  }
);
