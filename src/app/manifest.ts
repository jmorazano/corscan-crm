import type { MetadataRoute } from "next";
import { DEFAULT_BRANDING, resolveAccentSet } from "@/lib/branding";
import { pwaIconUrl } from "@/lib/pwa";
import { getSessionOrNull } from "@/lib/auth/session";
import { getBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

/**
 * Manifest PWA por marca (012, FR-003). El <link rel="manifest"> del layout
 * lleva `crossorigin="use-credentials"` para que la cookie de sesión viaje
 * y el manifest sea el de la empresa del usuario; sin sesión, la marca
 * neutra de la instancia. Sin service worker: la app es en tiempo real.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const session = await getSessionOrNull().catch(() => null);
  const branding = await getBranding(session?.organizationId).catch(
    () => DEFAULT_BRANDING
  );
  const accent = resolveAccentSet(branding.accent).accent;
  return {
    name: `${branding.name} — CRM de WhatsApp`,
    short_name: branding.name,
    description:
      "CRM de WhatsApp con agente de IA: bandeja, pipeline, contactos y campañas.",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: accent,
    lang: "es",
    icons: [
      {
        src: pwaIconUrl(192, branding),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: pwaIconUrl(512, branding),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: pwaIconUrl(512, branding, true),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
