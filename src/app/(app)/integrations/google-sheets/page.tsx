import { requireOwnerPage } from "@/lib/auth/owner-page";
import Link from "next/link";
import { GoogleSheetsClient } from "@/components/integrations/google-sheets-client";

export const dynamic = "force-dynamic";

export default async function GoogleSheetsIntegrationPage() {
  // 022: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 md:px-6 md:py-4">
        <p className="text-xs text-muted-foreground">
          <Link href="/integrations" className="hover:underline">
            Integraciones
          </Link>{" "}
          / Google Sheets
        </p>
        <h2 className="font-semibold">Google Sheets</h2>
        <p className="text-sm text-muted-foreground">
          El agente anota los comprobantes de transferencia en tu planilla de conciliación y consulta
          planillas con información que cambia seguido.
        </p>
      </header>
      <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        <GoogleSheetsClient />
      </div>
    </div>
  );
}
