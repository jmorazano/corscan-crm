import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { resolveMembership } from "@/server/auth/on-signup";
import { isSuperAdminEmail } from "@/server/auth/super-admin";

export type SessionContext = {
  userId: string;
  email: string;
  organizationId: string;
  role: string;
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

/**
 * Sesión + organización activa para route handlers y server components.
 * Lanza UnauthorizedError si no hay sesión u organización.
 */
export async function requireSession(): Promise<SessionContext> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();
  // La sesión puede crearse antes de que la membresía exista (registro
  // inicial) — la membresía en BD es la fuente de verdad de org + rol.
  const membership = await resolveMembership(session.user.id);
  if (!membership) {
    throw new UnauthorizedError("Sesión sin organización activa");
  }
  return {
    userId: session.user.id,
    email: session.user.email,
    organizationId: membership.organizationId,
    role: membership.role,
  };
}

/** Igual que requireSession pero devuelve null en vez de lanzar. */
export async function getSessionOrNull(): Promise<SessionContext | null> {
  try {
    return await requireSession();
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
  return { userId: session.user.id, email: session.user.email };
}
