import { IntegrationsIndex } from "@/components/integrations/integrations-index";

export const dynamic = "force-dynamic";

export default function IntegrationsPage() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-6 py-4">
        <h2 className="font-semibold">Integraciones</h2>
        <p className="text-sm text-muted-foreground">
          Conectá servicios externos a esta empresa. Cada empresa conecta sus
          propias cuentas; las credenciales se guardan cifradas.
        </p>
      </header>
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <IntegrationsIndex />
      </div>
    </div>
  );
}
