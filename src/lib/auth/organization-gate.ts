/**
 * Gate ALLOWLIST de los endpoints self-serve del plugin organization
 * (FR-013, research D5): la gestión de organizaciones y membresías es
 * exclusivamente server-side (inserts Drizzle) — ningún endpoint
 * `/organization/*` del plugin queda alcanzable desde el cliente.
 *
 * Semántica de allowlist: se niega TODO `/organization/*` que no esté
 * explícitamente permitido. La allowlist está VACÍA (la app no usa ninguno
 * desde el cliente), así que un upgrade del plugin que agregue endpoints
 * nuevos (teams, roles…) nace denegado en vez de abierto.
 */

/**
 * Paths mutantes enumerados en research D5 — el circuito de invitaciones
 * incluido: crearía membresías cross-org y rompería 1 usuario = 1 empresa.
 * La lista es documental (y se verifica UNO POR UNO en tests); el gate
 * niega por prefijo, no por esta enumeración.
 */
export const DENIED_ORGANIZATION_PATHS = [
  "/organization/create",
  "/organization/update",
  "/organization/delete",
  "/organization/set-active",
  "/organization/invite-member",
  "/organization/accept-invitation",
  "/organization/cancel-invitation",
  "/organization/reject-invitation",
  "/organization/remove-member",
  "/organization/update-member-role",
  "/organization/leave",
] as const;

const ALLOWED_ORGANIZATION_PATHS: ReadonlySet<string> = new Set();

/** true si el path del plugin organization debe negarse (allowlist vacía). */
export function isOrganizationPathDenied(path: string): boolean {
  if (!path.startsWith("/organization")) return false;
  return !ALLOWED_ORGANIZATION_PATHS.has(path);
}
