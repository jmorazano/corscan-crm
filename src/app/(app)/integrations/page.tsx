import { requireOwnerPage } from "@/lib/auth/owner-page";
import { IntegrationsIndex } from "@/components/integrations/integrations-index";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 md:px-6 md:py-4">
        <h2 className="font-semibold">Integraciones</h2>
        <p className="text-sm text-muted-foreground">
          Conectá servicios externos a esta empresa. Cada empresa conecta sus
          propias cuentas; las credenciales se guardan cifradas.
        </p>
      </header>
      <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        <IntegrationsIndex />
      </div>
    </div>
  );
}
