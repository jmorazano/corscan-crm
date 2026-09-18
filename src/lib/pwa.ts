import type { Branding } from "./branding";

/** Tamaños de ícono PWA servidos por `/api/pwa/icon/[size]` (012). */
export const PWA_ICON_SIZES = [180, 192, 512] as const;
export type PwaIconSize = (typeof PWA_ICON_SIZES)[number];

/**
 * URL del ícono con la marca EN LA QUERY: el navegador baja el manifest y
 * sus íconos sin cookies, así que la sesión no alcanza para resolver la
 * empresa; nombre y color ya son públicos en la UI.
 */
export function pwaIconUrl(
  size: PwaIconSize,
  branding: Branding,
  maskable = false
): string {
  const qs = new URLSearchParams({
    name: branding.name,
    accent: branding.accent.replace(/^#/, ""),
  });
  if (maskable) qs.set("maskable", "1");
  return `/api/pwa/icon/${size}?${qs}`;
}
