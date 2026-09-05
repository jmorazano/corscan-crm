import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isSuperAdminEmail } from "@/server/auth/super-admin";
import type { AdminDbConn } from "@/server/admin/organizations";

/**
 * Gestión de usuarios por el super admin (US5, contrato admin-api.md):
 * usuario adicional en una empresa existente y reset de contraseña sin
 * conocer la vieja. Hermano de organizations.ts (mismo patrón de alta).
 */

export type CreateOrganizationUserInput = {
  organizationId: string;
  name: string;
  email: string;
  password: string;
  role: "owner" | "member";
};

export type CreateOrganizationUserResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      code: "not_found" | "duplicate_email" | "reserved_email" | "invalid";
      message: string;
    };

/**
 * Usuario adicional en una empresa (FR-014). Mismo orden defensivo que
 * createOrganizationWithAdmin: validar email → validar org → usuario →
 * membresía. Aquí no hay rollback compensatorio porque no se crea ninguna
 * org: el peor crash deja un usuario sin membresía, que el reintento
 * detecta como duplicate_email y el super admin resuelve con un reset.
 */
export async function createOrganizationUser(
  input: CreateOrganizationUserInput,
  db: AdminDbConn = getDb()
): Promise<CreateOrganizationUserResult> {
  const email = input.email.trim().toLowerCase();

  // FR-016: los correos de SUPER_ADMIN_EMAILS están reservados para la
  // plataforma — nunca son cuenta de empresa (contrato admin-api.md).
  if (isSuperAdminEmail(email)) {
    return {
      ok: false,
      code: "reserved_email",
      message:
        "Ese correo está reservado para la administración de la plataforma",
    };
  }

  const orgs = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, input.organizationId));
  if (orgs.length === 0) {
    return { ok: false, code: "not_found", message: "La empresa no existe" };
  }

  // Pre-chequeo de duplicado ANTES de crear: sin efectos parciales.
  const existing = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email));
  if (existing.length > 0) {
    return {
      ok: false,
      code: "duplicate_email",
      message: "Ya existe una cuenta con ese correo",
    };
  }

  // Import diferido: @/lib/auth → on-signup → organizations (ciclo en eval).
  const { getAuth, runInternalSignup } = await import("@/lib/auth");
  let newUserId: string;
  try {
    const result = await runInternalSignup(() =>
      getAuth().api.signUpEmail({
        body: { name: input.name, email, password: input.password },
      })
    );
    newUserId = result.user.id;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo crear la cuenta";
    // Carrera contra el pre-chequeo: el UNIQUE de email manda.
    if (/exist/i.test(message)) {
      return {
        ok: false,
        code: "duplicate_email",
        message: "Ya existe una cuenta con ese correo",
      };
    }
    return { ok: false, code: "invalid", message };
  }

  await db
    .insert(schema.member)
    .values({
      id: newId("organization"),
      organizationId: input.organizationId,
      userId: newUserId,
      role: input.role,
    })
    .onConflictDoNothing();

  // Contraseña temporal (FR-017): el titular debe cambiarla al estrenar la
  // cuenta — corta el acceso del super admin que la generó.
  await db
    .update(schema.user)
    .set({ mustChangePassword: true, updatedAt: new Date() })
    .where(eq(schema.user.id, newUserId));

  return { ok: true, userId: newUserId };
}

export type ResetUserPasswordInput = {
  userId: string;
  password: string;
  /** Email del super admin que opera: un super admin puede resetear SU
   * propia cuenta, jamás la de otro super admin (contrato admin-api.md). */
  operatorEmail: string;
};

export type ResetUserPasswordResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "forbidden"; message: string };

/**
 * Reset de contraseña (FR-014/FR-017): setea una temporal nueva SIN conocer
 * la vieja. Usa el mismo par que el plugin admin oficial de better-auth
 * usa server-side — `$context.password.hash` (el hasher configurado) +
 * `internalAdapter.updatePassword` (cuenta `credential` vía el adapter) —
 * sin habilitar el plugin. Efectos: must_change_password = true e
 * invalidación de TODAS las sesiones del usuario (el que conocía la
 * temporal vieja, o un atacante con sesión viva, quedan fuera).
 */
export async function resetUserPassword(
  input: ResetUserPasswordInput,
  db: AdminDbConn = getDb()
): Promise<ResetUserPasswordResult> {
  const users = await db
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, input.userId));
  const target = users[0];
  if (!target) {
    return { ok: false, code: "not_found", message: "El usuario no existe" };
  }

  // Un super admin ajeno NO es reseteable (contrato admin-api.md): sería
  // tomar la cuenta de plataforma de otro operador.
  const targetEmail = target.email.trim().toLowerCase();
  if (
    isSuperAdminEmail(targetEmail) &&
    targetEmail !== input.operatorEmail.trim().toLowerCase()
  ) {
    return {
      ok: false,
      code: "forbidden",
      message: "No se puede restablecer la contraseña de otro super admin",
    };
  }

  // Import diferido: mismo ciclo en eval que en createOrganizationUser.
  const { getAuth } = await import("@/lib/auth");
  const authCtx = await getAuth().$context;
  const hashed = await authCtx.password.hash(input.password);
  const accounts = await authCtx.internalAdapter.findAccounts(input.userId);
  if (accounts.some((a) => a.providerId === "credential")) {
    await authCtx.internalAdapter.updatePassword(input.userId, hashed);
  } else {
    // Usuario sin cuenta credential (no debería pasar en esta instancia,
    // todas nacen por signUpEmail): se crea, como hace el plugin admin.
    await authCtx.internalAdapter.createAccount({
      userId: input.userId,
      providerId: "credential",
      accountId: input.userId,
      password: hashed,
    });
  }

  await db
    .update(schema.user)
    .set({ mustChangePassword: true, updatedAt: new Date() })
    .where(eq(schema.user.id, input.userId));

  // Invalidación de sesiones: sin cookieCache configurado, borrar las filas
  // corta el acceso en la siguiente request de cada sesión viva.
  await db
    .delete(schema.session)
    .where(eq(schema.session.userId, input.userId));

  return { ok: true };
}
