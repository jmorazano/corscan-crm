import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { getPublicBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

/**
 * Página de inicio PÚBLICA. Con sesión → bandeja. Sin sesión, una landing
 * mínima con el nombre público de la instancia (APP_PUBLIC_NAME): Google
 * compara el nombre de la app del consent screen con lo que muestra esta
 * URL, así que el nombre va en <h1> y en <title> (layout raíz), sin
 * redirecciones.
 */
export default async function Home() {
  const session = await getSessionOrNull().catch(() => null);
  if (session) redirect("/inbox");

  const branding = getPublicBranding();
  let privacyUrl: string | undefined;
  let termsUrl: string | undefined;
  try {
    const env = getEnv();
    privacyUrl = env.APP_PRIVACY_URL;
    termsUrl = env.APP_TERMS_URL;
  } catch {
    // sin env válido no hay enlaces legales
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-subtle p-6 text-center">
      <span
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-brand text-2xl font-bold text-white"
        aria-hidden
      >
        {branding.name.charAt(0).toUpperCase()}
      </span>
      <h1 className="text-3xl font-bold tracking-tight">{branding.name}</h1>
      <p className="mt-2 max-w-md text-base text-text-2">
        CRM de WhatsApp con agente de IA: atiende, organiza y convierte las
        conversaciones de tu negocio, y agenda turnos en tu Google Calendar.
      </p>
      <Link
        href="/login"
        className="mt-6 inline-flex h-10 items-center rounded-md bg-brand px-6 text-sm font-medium text-white hover:opacity-90"
      >
        Ingresar
      </Link>
      {(privacyUrl || termsUrl) && (
        <nav className="mt-10 flex gap-4 text-xs text-text-3">
          {privacyUrl && (
            <a href={privacyUrl} className="hover:underline">
              Política de privacidad
            </a>
          )}
          {termsUrl && (
            <a href={termsUrl} className="hover:underline">
              Términos de servicio
            </a>
          )}
        </nav>
      )}
    </main>
  );
}
