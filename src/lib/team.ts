/**
 * 045: qué puede hacer el propietario sobre cada persona del equipo
 * (Ajustes → Equipo). PURO: lo usan la API (guarda real) y la UI (botones
 * deshabilitados con su motivo), así nunca discrepan.
 *
 * - Quitar: saca la membresía de ESTA empresa; si la persona no tiene
 *   otras, su cuenta se elimina (misma regla que Administración, 019).
 * - Restablecer contraseña: solo cuentas que usan ÚNICAMENTE esta empresa.
 *   Una cuenta compartida con otras empresas le daría al propietario de una
 *   la llave de las demás (tenencia, constitución III).
 * - Cambiar el rol: solo la membresía de esta empresa; nunca deja la
 *   empresa sin propietario.
 *
 * Sobre sí mismo el propietario no opera desde acá (su contraseña se cambia
 * en Ajustes → Mi contraseña; su rol lo cambia otro propietario) y las cuentas
 * de la administración de la plataforma no se tocan.
 */

export type TeamRole = "owner" | "member";

export type TeamMemberFacts = {
  role: string;
  isSelf: boolean;
  /** Correo en SUPER_ADMIN_EMAILS (cuenta de la plataforma). */
  isPlatform: boolean;
  /** Cantidad de OTRAS empresas a las que pertenece la cuenta. */
  otherOrganizations: number;
  /** Propietarios de esta empresa (incluido él si lo es). */
  ownerCount: number;
};

export type TeamActionCode =
  | "self"
  | "platform"
  | "shared_account"
  | "last_owner";

export type TeamActionCheck =
  | { ok: true }
  | { ok: false; code: TeamActionCode; reason: string };

export type TeamMemberActions = {
  remove: TeamActionCheck;
  resetPassword: TeamActionCheck;
  changeRole: TeamActionCheck;
};

const OK: TeamActionCheck = { ok: true };

function deny(code: TeamActionCode, reason: string): TeamActionCheck {
  return { ok: false, code, reason };
}

export function isTeamRole(role: string): role is TeamRole {
  return role === "owner" || role === "member";
}

export function teamMemberActions(m: TeamMemberFacts): TeamMemberActions {
  if (m.isSelf) {
    return {
      remove: deny("self", "No podés quitarte a vos mismo"),
      resetPassword: deny(
        "self",
        "Tu contraseña se cambia desde Ajustes → Mi contraseña"
      ),
      changeRole: deny(
        "self",
        "Tu rol lo cambia otro propietario de la empresa"
      ),
    };
  }
  if (m.isPlatform) {
    const platform = deny(
      "platform",
      "Es una cuenta de la administración de la plataforma"
    );
    return { remove: platform, resetPassword: platform, changeRole: platform };
  }
  const lastOwner =
    m.role === "owner" && m.ownerCount <= 1
      ? deny(
          "last_owner",
          "Es el único propietario: nombrá otro propietario antes"
        )
      : OK;
  return {
    remove: lastOwner,
    resetPassword:
      m.otherOrganizations > 0
        ? deny(
            "shared_account",
            "También usa otras empresas: puede recuperarla con «¿Olvidaste tu contraseña?» o pedírsela a la administración"
          )
        : OK,
    changeRole: lastOwner,
  };
}

export function teamRoleLabel(role: string): string {
  return role === "owner" ? "Propietario" : "Miembro";
}
