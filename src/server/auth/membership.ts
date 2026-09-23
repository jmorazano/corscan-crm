import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isSuperAdminEmail } from "@/server/auth/super-admin";

/**
 * Sumar una cuenta EXISTENTE a una empresa (018, FR-008). Compartido por
 * Administración (super admin) y Ajustes → Equipo (propietario): ninguno
 * de los dos crea contraseña ni exige cambiarla — la persona conserva la
 * suya. Idempotente: la unicidad (empresa, usuario) vive en la BD y acá se
 * pre-chequea para responder 409 claro.
 */

/** Subconjunto de conexión que necesita el módulo (sirve el stub de tests). */
export type MembershipDbConn = Pick<
  ReturnType<typeof getDb>,
  "select" | "insert"
>;

export type AttachExistingUserInput = {
  organizationId: string;
  email: string;
  role: "owner" | "member";
};

export type AttachExistingUserResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      code: "not_found" | "user_not_found" | "reserved_email" | "already_member";
      message: string;
    };

export async function isMemberOf(
  userId: string,
  organizationId: string,
  db: MembershipDbConn = getDb()
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, userId),
        eq(schema.member.organizationId, organizationId)
      )
    );
  return rows.length > 0;
}

export async function findUserIdByEmail(
  email: string,
  db: MembershipDbConn = getDb()
): Promise<string | null> {
  const rows = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email.trim().toLowerCase()));
  return rows[0]?.id ?? null;
}

export async function attachExistingUser(
  input: AttachExistingUserInput,
  db: MembershipDbConn = getDb()
): Promise<AttachExistingUserResult> {
  const email = input.email.trim().toLowerCase();

  // FR-016 (003): los correos de plataforma nunca son cuenta de empresa.
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

  const userId = await findUserIdByEmail(email, db);
  if (!userId) {
    return {
      ok: false,
      code: "user_not_found",
      message: "No existe una cuenta con ese correo",
    };
  }

  if (await isMemberOf(userId, input.organizationId, db)) {
    return {
      ok: false,
      code: "already_member",
      message: "Esa cuenta ya es miembro de esta empresa",
    };
  }

  await db
    .insert(schema.member)
    .values({
      id: newId("member"),
      organizationId: input.organizationId,
      userId,
      role: input.role,
    })
    // Carrera contra el pre-chequeo: la unicidad de la BD manda.
    .onConflictDoNothing();

  return { ok: true, userId };
}
