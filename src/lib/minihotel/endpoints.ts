import type { ContentOperation } from "./requests";

/**
 * Direcciones de MiniHotel (028). El super admin fija UNA sola dirección —la
 * de la API ARI (`…/gds`)— y la de la API de contenido se DERIVA de esa con
 * una regla fija de código. Así se cumple que "la URL la fija solo el super
 * admin" (Constitución II, cat. 5, letra b) aunque el proveedor reparta sus
 * APIs en dos hosts en producción (`api` y `api2`).
 *
 * Verificado contra la documentación (1-oct-2026):
 * - sandbox: ARI y contenido en `https://sandbox.minihotel.cloud`;
 * - producción: ARI en `https://api.minihotel.cloud/gds`, contenido en
 *   `https://api2.minihotel.cloud/agents/ws/settings/rooms/RoomsMain.asmx/…`.
 *
 * Con el simulador local (`/api/dev/minihotel-mock/gds`) la regla general
 * —mismo origen, mismo prefijo— apunta al mismo simulador.
 */

export const MINIHOTEL_ENDPOINTS = {
  sandbox: "https://sandbox.minihotel.cloud/gds",
  production: "https://api.minihotel.cloud/gds",
} as const;

export type MiniHotelEnvironment = "sandbox" | "production" | "custom";

const PRODUCTION_ARI_HOST = "api.minihotel.cloud";
const PRODUCTION_CONTENT_ORIGIN = "https://api2.minihotel.cloud";
export const CONTENT_PATH = "/agents/ws/settings/rooms/RoomsMain.asmx/";

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** ¿La dirección es la de una API ARI (`…/gds`)? */
export function isAriEndpoint(raw: string): boolean {
  const url = parse(raw);
  if (!url) return false;
  return /\/gds$/i.test(url.pathname.replace(/\/+$/, ""));
}

/** Dirección de la API de contenido para esa ARI; `null` si no es una ARI. */
export function contentUrlFor(ariEndpoint: string, op: ContentOperation): string | null {
  const url = parse(ariEndpoint);
  if (!url) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (!/\/gds$/i.test(path)) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === PRODUCTION_ARI_HOST) {
    return `${PRODUCTION_CONTENT_ORIGIN}${CONTENT_PATH}${op}`;
  }
  const prefix = path.slice(0, -"/gds".length);
  return `${url.origin}${prefix}${CONTENT_PATH}${op}`;
}

export function environmentOf(ariEndpoint: string): MiniHotelEnvironment {
  const url = parse(ariEndpoint);
  if (!url) return "custom";
  const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  if (normalized === MINIHOTEL_ENDPOINTS.sandbox) return "sandbox";
  if (normalized === MINIHOTEL_ENDPOINTS.production) return "production";
  return "custom";
}
