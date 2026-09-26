import { requireOwnerPage } from "@/lib/auth/owner-page";
import Link from "next/link";
import { MercadoLibreClient } from "@/components/integrations/mercadolibre-client";

export const dynamic = "force-dynamic";

export default async function MercadoLibreIntegrationPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 md:px-6 md:py-4">
        <p className="text-xs text-muted-foreground">
          <Link href="/integrations" className="hover:underline">
            Integraciones
          </Link>{" "}
          / Mercado Libre
        </p>
        <h2 className="font-semibold">Mercado Libre</h2>
        <p className="text-sm text-muted-foreground">
          El agente conoce tus publicaciones vigentes: ofrece las que coinciden con lo que
          busca cada cliente, con su precio y enlace, y junta los pedidos de visita para que
          los confirmes vos.
        </p>
      </header>
      <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        <MercadoLibreClient />
      </div>
    </div>
  );
}
