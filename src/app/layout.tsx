import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import {
  accentCssVariables,
  DEFAULT_BRANDING,
  resolveAccentSet,
} from "@/lib/branding";
import { pwaIconUrl } from "@/lib/pwa";
import { getSessionOrNull } from "@/lib/auth/session";
import { getBranding } from "@/server/branding";
import "./globals.css";

/**
 * Marca según la sesión: la organización del usuario autenticado, o la marca
 * neutra de la instancia para visitantes anónimos (login). Con N empresas,
 * jamás la de "una organización cualquiera" (US2: cero fuga cross-tenant).
 */
async function resolveBranding() {
  const session = await getSessionOrNull().catch(() => null);
  return getBranding(session?.organizationId).catch(() => DEFAULT_BRANDING);
}

// next/font descarga la fuente en BUILD y la sirve self-hosted (sin CDN).
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await resolveBranding();
  return {
    title: `${branding.name} — CRM de WhatsApp`,
    description: "CRM de WhatsApp con agente de IA y Laboratorio de auto-evaluación",
    // 012: instalable en la pantalla de inicio (iOS lee estos metadatos; el
    // manifest va a mano en <head> para que viaje la cookie de sesión).
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: branding.name,
    },
    icons: {
      icon: [{ url: pwaIconUrl(192, branding), sizes: "192x192", type: "image/png" }],
      apple: [{ url: pwaIconUrl(180, branding), sizes: "180x180", type: "image/png" }],
    },
  };
}

/**
 * 012: viewport móvil. `viewportFit: cover` habilita las zonas seguras
 * (notch/barra de gestos); `interactiveWidget: resizes-content` hace que el
 * teclado virtual achique el layout (Android) en vez de taparlo. Sin
 * `maximumScale`: el zoom por pellizco sigue disponible (accesibilidad).
 */
export async function generateViewport(): Promise<Viewport> {
  const branding = await resolveBranding();
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    interactiveWidget: "resizes-content",
    themeColor: resolveAccentSet(branding.accent).accent,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await resolveBranding();
  return (
    <html lang="es" className={geist.variable}>
      <head>
        {/* Acento white-label inyectado en SSR: sin flash de tema */}
        <style
          dangerouslySetInnerHTML={{ __html: accentCssVariables(branding.accent) }}
        />
        {/* Con credenciales: el manifest es el de la empresa de la sesión */}
        <link
          rel="manifest"
          href="/manifest.webmanifest"
          crossOrigin="use-credentials"
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
