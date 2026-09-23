import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { resolveActiveMembership } from "@/server/auth/on-signup";
import { isSuperAdminEmail } from "@/server/auth/super-admin";

export type SessionContext = {
  userId: string;
  email: string;
  organizationId: string;
  role: string;
  /** 018: id de la fila de sesión (para cambiar de espacio de trabajo). */
  sessionId: string;
};

/** Sombrero de plataforma (research D2): sin membresía de organización. */
export type SuperAdminContext = {
  userId: string;
  email: string;
};

export class UnauthorizedError extends Error {
  constructor(message = "No autenticado") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Acceso denegado") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** FR-017: la sesión existe pero su contraseña temporal sigue vigente. */
export class PasswordChangeRequiredError extends Error {
  constructor(message = "Cambio de contraseña pendiente") {
    super(message);
    this.name = "PasswordChangeRequiredError";
  }
}

/**
 * FR-017 en la capa de sesión: con `must_change_password` vigente la cuenta
 * no opera — ni por páginas ni por API directa (sin esto, quien generó la
 * temporal podría operar como el usuario vía curl sin pasar por el shell).
 * Único camino exento: el cambio de contraseña propio (requireSessionUser).
 */
async function assertPasswordNotPending(userId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ pending: schema.user.mustChangePassword })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  if (rows[0]?.pending) throw new PasswordChangeRequiredError();
}

/**
 * Sesión + organización activa para route handlers y server components.
 * Lanza UnauthorizedError si no hay sesión u organización.
 */
export async function requireSession(options?: {
  /**
   * true SOLO para el shell de páginas, que necesita el contexto para poder
   * redirigir a /change-password; la API nunca lo pasa.
   */
  allowPendingPassword?: boolean;
}): Promise<SessionContext> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();
  // 018: la empresa activa vive en la sesión (activeOrganizationId del
  // plugin organization) y se valida contra las membresías en CADA pedido.
  // La sesión puede crearse antes de que la membresía exista (registro
  // inicial) o apuntar a una empresa de la que ya no es miembro — la
  // membresía en BD es la fuente de verdad de org + rol, y ante un
  // desajuste se repara la sesión (fallback determinista a la más antigua).
  const sessionRow = (session as { session?: SessionRowLike }).session;
  const preferred = sessionRow?.activeOrganizationId ?? null;
  const membership = await resolveActiveMembership(session.user.id, preferred);
  if (!membership) {
    throw new UnauthorizedError("Sesión sin organización activa");
  }
  if (!membership.matchedPreferred && sessionRow?.id) {
    void repairSessionOrganization(sessionRow.id, membership.organizationId);
  }
  if (!options?.allowPendingPassword) {
    await assertPasswordNotPending(session.user.id);
  }
  return {
    userId: session.user.id,
    email: session.user.email,
    organizationId: membership.organizationId,
    role: membership.role,
    sessionId: sessionRow?.id ?? "",
  };
}

type SessionRowLike = { id?: string; activeOrganizationId?: string | null };

/**
 * Repara `session.active_organization_id` cuando apunta a una empresa que
 * ya no es del usuario (o está vacío). En segundo plano y tolerante: un
 * fallo acá no puede tumbar el pedido.
 */
async function repairSessionOrganization(
  sessionId: string,
  organizationId: string
): Promise<void> {
  try {
    await getDb()
      .update(schema.session)
      .set({ activeOrganizationId: organizationId, updatedAt: new Date() })
      .where(eq(schema.session.id, sessionId));
  } catch {
    // se reintenta en el próximo pedido
  }
}

/**
 * Igual que requireSession pero devuelve null en vez de lanzar. Tolera la
 * contraseña temporal: lo usa el shell de páginas, que es quien redirige a
 * /change-password.
 */
export async function getSessionOrNull(): Promise<SessionContext | null> {
  try {
    return await requireSession({ allowPendingPassword: true });
  } catch {
    return null;
  }
}

/**
 * Sesión SIN exigir membresía: para operaciones sobre la propia cuenta
 * (p. ej. cambiar la contraseña), que deben servir también a un super admin
 * sin organización (research D2 / contrato FR-017).
 */
export async function requireSessionUser(): Promise<SuperAdminContext> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();
  return { userId: session.user.id, email: session.user.email };
}

/**
 * Sesión de super admin (research D2): resuelve la sesión SIN exigir
 * membresía de organización — el sombrero de plataforma no depende del de
 * empresa. Lanza UnauthorizedError sin sesión y ForbiddenError si el email
 * no figura en SUPER_ADMIN_EMAILS (sin la variable, siempre Forbidden).
 */
export async function requireSuperAdmin(): Promise<SuperAdminContext> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();
  if (!isSuperAdminEmail(session.user.email)) {
    throw new ForbiddenError("Solo el super admin puede acceder");
  }
  await assertPasswordNotPending(session.user.id);
  return { userId: session.user.id, email: session.user.email };
}
