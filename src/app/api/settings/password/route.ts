import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { APIError } from "better-auth/api";
import { apiError, parseBody } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import {
  requireSessionUser,
  UnauthorizedError,
  type SuperAdminContext,
} from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

const changeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

/**
 * Cambio de contraseña propio (FR-017): disponible siempre, obligatorio en
 * el primer login con contraseña temporal. Revoca las demás sesiones —
 * quien conocía la temporal (super admin u owner) pierde el acceso.
 *
 * No exige membresía de organización: un super admin sin empresa también
 * cambia su propia contraseña (contrato admin-api.md).
 */
export async function POST(req: Request): Promise<Response> {
  let session: SuperAdminContext;
  try {
    session = await requireSessionUser();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return apiError(401, "unauthorized", "No autenticado");
    }
    throw err;
  }

  const body = await parseBody(req, changeSchema);
  if (!body.ok) return body.response;

  const auth = getAuth();
  // revokeOtherSessions borra TODAS las sesiones y emite una nueva por
  // Set-Cookie: hay que reenviarla, o el navegador queda con una cookie
  // muerta y el usuario rebota a /login recién cambiada la contraseña.
  let authCookies: string | null = null;
  try {
    const { headers: authHeaders } = await auth.api.changePassword({
      headers: await headers(),
      returnHeaders: true,
      body: {
        currentPassword: body.data.currentPassword,
        newPassword: body.data.newPassword,
        revokeOtherSessions: true,
      },
    });
    authCookies = authHeaders.get("set-cookie");
  } catch (err) {
    if (err instanceof APIError) {
      return apiError(
        403,
        "invalid_current_password",
        "La contraseña actual no es correcta"
      );
    }
    throw err;
  }

  try {
    const db = getDb();
    await db
      .update(schema.user)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(eq(schema.user.id, session.userId));
  } catch (err) {
    console.error("[api] error no controlado:", err);
    return apiError(500, "internal", "Error interno");
  }

  const res = Response.json({ ok: true });
  if (authCookies) res.headers.set("set-cookie", authCookies);
  return res;
}
