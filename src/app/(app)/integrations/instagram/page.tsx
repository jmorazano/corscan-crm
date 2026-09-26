import { requireOwnerPage } from "@/lib/auth/owner-page";
import Link from "next/link";
import { InstagramClient } from "@/components/integrations/instagram-client";

export const dynamic = "force-dynamic";

export default async function InstagramIntegrationPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 md:px-6 md:py-4">
        <p className="text-xs text-muted-foreground">
          <Link href="/integrations" className="hover:underline">
            Integraciones
          </Link>{" "}
          / Instagram Direct
        </p>
        <h2 className="font-semibold">Instagram Direct</h2>
        <p className="text-sm text-muted-foreground">
          Los mensajes directos de la cuenta de Instagram del negocio entran a la
          misma Bandeja que WhatsApp, y el agente los atiende con el mismo
          conocimiento.
        </p>
      </header>
      <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        <InstagramClient />
      </div>
    </div>
  );
}
