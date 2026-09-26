/**
 * Reglas PURAS de los roles de empresa (022). Better Auth guarda `owner` o
 * `member` en `member.role`; acá se decide qué puede ver y tocar cada uno,
 * compartido por el sidebar, la hoja «Más», la navegación de Ajustes, las
 * guardas de página y las de API.
 *
 * La regla de producto: un miembro OPERA (bandeja, pipeline, contactos,
 * campañas) y administra lo suyo (notificaciones de su dispositivo, su
 * contraseña). Todo lo que configura la empresa —agente, laboratorio,
 * integraciones, el resto de Ajustes y el Entrenador— es del propietario.
 */

export type OrgRole = "owner" | "member";

/** ¿Este rol puede configurar la empresa? */
export function canManageConfig(role: string): boolean {
  return role === "owner";
}

/**
 * Secciones de la app que solo ve (y usa) el propietario. 024: Métricas no
 * es configuración, pero es del propietario (spec 024).
 */
export const OWNER_ONLY_SECTIONS = ["/agent", "/lab", "/integrations", "/metrics"] as const;

/**
 * Pestañas de Ajustes que un miembro sí tiene: son personales, no de la
 * empresa. Cualquier otra ruta bajo `/settings` es del propietario.
 */
export const MEMBER_SETTINGS_PATHS = ["/settings/notifications"] as const;

/** ¿Un miembro puede abrir esta ruta de configuración? */
export function memberCanOpen(pathname: string): boolean {
  if (OWNER_ONLY_SECTIONS.some((s) => pathname === s || pathname.startsWith(`${s}/`))) {
    return false;
  }
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return MEMBER_SETTINGS_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  }
  return true;
}

/** Ruta a la que cae `/settings` según el rol. */
export function settingsHomeFor(role: string): string {
  return canManageConfig(role) ? "/settings/whatsapp" : "/settings/notifications";
}

export type NavItem<T> = T & { href: string };

/**
 * Filtra una lista de ítems de navegación por rol: el propietario ve todo;
 * el miembro pierde las secciones de configuración y las pestañas de
 * Ajustes que no son suyas.
 */
export function navItemsFor<T extends { href: string }>(role: string, items: readonly T[]): T[] {
  if (canManageConfig(role)) return [...items];
  return items.filter((i) => memberCanOpen(i.href));
}
