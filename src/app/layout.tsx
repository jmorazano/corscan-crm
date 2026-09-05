import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { accentCssVariables, DEFAULT_BRANDING } from "@/lib/branding";
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
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
