import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { isEmailReservedForOperator } from "@/server/auth/super-admin";
import {
  attachExistingUser,
  findUserIdByEmail,
  isMemberOf,
} from "@/server/auth/membership";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const members = await db
    .select({
      id: schema.member.id,
      role: schema.member.role,
      createdAt: schema.member.createdAt,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(scoped(schema.member.organizationId, session.organizationId));
  return Response.json({
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      name: m.name,
      email: m.email,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
  attachExisting: z.literal(false).optional(),
});

/** 018: sumar una cuenta existente de la instancia como miembro. */
const attachSchema = z.object({
  email: z.string().trim().email(),
  attachExisting: z.literal(true),
});

const bodySchema = z.union([attachSchema, createSchema]);

/**
 * Alta de cuenta de equipo (owner only): email + contraseña temporal
 * (FR-061) o, con `attachExisting: true`, sumar una cuenta que ya existe
 * en la instancia (018, FR-008) — conserva su contraseña.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede crear cuentas");
  }
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const data = body.data;

  // Anti-escalación (FR-016): los correos de SUPER_ADMIN_EMAILS están
  // reservados — un owner no puede darles de alta una cuenta de empresa.
  if (isEmailReservedForOperator(data.email, session.email)) {
    return apiError(
      403,
      "reserved_email",
      "Ese correo está reservado para la administración de la plataforma"
    );
  }

  if (data.attachExisting === true) {
    const attached = await attachExistingUser({
      organizationId: session.organizationId,
      email: data.email,
      role: "member",
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
    return Response.json({ ok: true, attached: true });
  }

  // 018: si el correo ya tiene cuenta, se ofrece sumarla en vez de fallar.
  const existingId = await findUserIdByEmail(data.email);
  if (existingId) {
    const member = await isMemberOf(existingId, session.organizationId);
    return apiError(
      409,
      "duplicate",
      member
        ? "Esa cuenta ya es miembro de esta empresa"
        : "Ya existe una cuenta con ese correo",
      { canAttach: !member }
    );
  }

  const auth = getAuth();
  let newUserId: string;
  try {
    const result = await runInternalSignup(() =>
      auth.api.signUpEmail({
        body: {
          name: data.name,
          email: data.email,
          password: data.password,
        },
      })
    );
    newUserId = result.user.id;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo crear la cuenta";
    if (/exist/i.test(message)) {
      return apiError(409, "duplicate", "Ya existe una cuenta con ese correo");
    }
    return apiError(422, "invalid", message);
  }

  const db = getDb();
  await db
    .insert(schema.member)
    .values({
      id: newId("organization"),
      organizationId: session.organizationId,
      userId: newUserId,
      role: "member",
    })
    .onConflictDoNothing();

  // Contraseña temporal (FR-017): el titular debe cambiarla al estrenar la
  // cuenta — corta el acceso de quien la generó.
  await db
    .update(schema.user)
    .set({ mustChangePassword: true, updatedAt: new Date() })
    .where(eq(schema.user.id, newUserId));

  return Response.json({ ok: true }, { status: 201 });
});
