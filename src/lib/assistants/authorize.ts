/**
 * Quién puede leer qué empresa por un asistente conectado (040, research
 * D7). Módulo PURO: la BD aporta los hechos, acá se decide.
 */

export type WorkspaceAccess = "ok" | "not_authorized" | "disabled" | "not_owner";

export function decideWorkspaceAccess(facts: {
  /** La empresa está entre las elegidas en el consentimiento. */
  inGrant: boolean;
  /** Switch «Permitir asistentes externos» de la empresa. */
  enabled: boolean;
  /** Rol ACTUAL del usuario en la empresa (null = ya no es miembro). */
  role: string | null;
}): WorkspaceAccess {
  if (!facts.inGrant) return "not_authorized";
  if (facts.role !== "owner") return "not_owner";
  if (!facts.enabled) return "disabled";
  return "ok";
}

export type GrantWorkspace = { id: string; name: string; slug: string | null };

/**
 * Resuelve el parámetro `workspace` contra las empresas de la conexión: id
 * `org_…`, nombre o slug exactos sin distinguir mayúsculas. Omitido → la
 * única empresa activa, si hay exactamente una.
 */
export function resolveWorkspaceRef(
  ref: string | undefined | null,
  workspaces: readonly GrantWorkspace[],
  activeIds: ReadonlySet<string>
): { ok: true; workspace: GrantWorkspace } | { ok: false; reason: "ambiguous" | "unknown" } {
  const wanted = (ref ?? "").trim();
  if (!wanted) {
    const active = workspaces.filter((w) => activeIds.has(w.id));
    if (active.length === 1) return { ok: true, workspace: active[0]! };
    return { ok: false, reason: "ambiguous" };
  }
  const byId = workspaces.find((w) => w.id === wanted);
  if (byId) return { ok: true, workspace: byId };
  const lower = wanted.toLocaleLowerCase("es");
  const matches = workspaces.filter(
    (w) => w.name.toLocaleLowerCase("es") === lower || (w.slug !== null && w.slug.toLowerCase() === lower)
  );
  if (matches.length === 1) return { ok: true, workspace: matches[0]! };
  return { ok: false, reason: matches.length > 1 ? "ambiguous" : "unknown" };
}

/** Texto que ve el asistente cuando una empresa no se puede consultar. */
export function workspaceDeniedText(access: Exclude<WorkspaceAccess, "ok">, name: string | null): string {
  const who = name ? `«${name}»` : "esa empresa";
  switch (access) {
    case "not_authorized":
      return "No tengo acceso a esa empresa. Si sos su propietario, volvé a conectar el asistente y tildala en la pantalla de permiso.";
    case "not_owner":
      return `Ya no sos propietario de ${who}: el acceso del asistente a esa empresa quedó cortado.`;
    case "disabled":
      return `El acceso de asistentes está desactivado en ${who}. El propietario lo puede activar en Ajustes → Asistentes.`;
  }
}
