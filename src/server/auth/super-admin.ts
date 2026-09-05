/**
 * Rol de plataforma por configuración (research D1): deriva de
 * SUPER_ADMIN_EMAILS (lista separada por comas), sin columnas en la base.
 * Se lee process.env directamente (patrón de registration.ts) para que el
 * valor vigente mande en cada request.
 */

export function superAdminEmails(): string[] {
  const raw = process.env.SUPER_ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/** true si el email pertenece a un super admin (case-insensitive, trim). */
export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return superAdminEmails().includes(email.trim().toLowerCase());
}

/**
 * Regla anti-escalación (FR-016): como el rol deriva del email y la
 * instancia NO verifica emails, los correos de SUPER_ADMIN_EMAILS quedan
 * reservados — solo un super admin puede crear/editar cuentas con ellos.
 * Sin esto, un owner de empresa daría de alta un "miembro" con un email
 * reservado aún sin cuenta y tomaría la plataforma.
 */
export function isEmailReservedForOperator(
  targetEmail: string,
  operatorEmail: string | null | undefined
): boolean {
  return isSuperAdminEmail(targetEmail) && !isSuperAdminEmail(operatorEmail);
}
