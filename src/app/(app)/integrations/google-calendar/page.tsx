import Link from "next/link";
import { GoogleCalendarClient } from "@/components/integrations/google-calendar-client";

export const dynamic = "force-dynamic";

export default function GoogleCalendarIntegrationPage() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-6 py-4">
        <p className="text-xs text-muted-foreground">
          <Link href="/integrations" className="hover:underline">
            Integraciones
          </Link>{" "}
          / Google Calendar
        </p>
        <h2 className="font-semibold">Google Calendar</h2>
        <p className="text-sm text-muted-foreground">
          El agente consulta horarios libres y agenda turnos en el calendario del
          negocio, según las reglas que definas acá.
        </p>
      </header>
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <GoogleCalendarClient />
      </div>
    </div>
  );
}
