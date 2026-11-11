import Link from "next/link";
import { requireOwnerPage } from "@/lib/auth/owner-page";
import { AirbnbCalendarsClient } from "@/components/integrations/airbnb-calendars-client";

export const dynamic = "force-dynamic";

export default async function AirbnbCalendarsPage() {
  // 051: configuración de la empresa — solo el propietario.
  await requireOwnerPage();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 md:px-6 md:py-4">
        <p className="text-xs text-muted-foreground">
          <Link href="/integrations" className="hover:underline">
            Integraciones
          </Link>{" "}
          / Calendarios de Airbnb
        </p>
        <h2 className="font-semibold">Calendarios de Airbnb</h2>
        <p className="text-sm text-muted-foreground">
          Si tu sistema sincroniza la ocupación con Airbnb, el calendario de cada publicación dice qué
          noches están tomadas. El agente lo usa para saber qué unidades están libres y le manda al
          cliente tu enlace para reservar.
        </p>
      </header>
      <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        <AirbnbCalendarsClient />
      </div>
    </div>
  );
}
