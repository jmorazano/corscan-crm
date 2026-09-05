import { z } from "zod";
import { apiError, parseBody, withSuperAdmin } from "@/lib/api";
import {
  createOrganizationWithAdmin,
  listOrganizations,
} from "@/server/admin/organizations";

export const dynamic = "force-dynamic";

/** Administración (contrato admin-api.md): solo super admin (FR-004). */
export const GET = withSuperAdmin(async () => {
  return Response.json({ organizations: await listOrganizations() });
});

const createSchema = z.object({
  organizationName: z.string().trim().min(1).max(120),
  admin: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email(),
    // Min 8 server-side (D7): jamás se confía en el generador del cliente.
    password: z.string().min(8).max(128),
  }),
});

export const POST = withSuperAdmin(async (_ctx, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const result = await createOrganizationWithAdmin(body.data);
  if (!result.ok) {
    const status =
      result.code === "duplicate_email"
        ? 409
        : result.code === "reserved_email"
          ? 403
          : 422;
    return apiError(status, result.code, result.message);
  }
  return Response.json({
    organizationId: result.organizationId,
    slug: result.slug,
  });
});
