import { requireOwnerPage } from "@/lib/auth/owner-page";
import { MetricsClient } from "@/components/metrics/metrics-client";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  // 024: las métricas son del propietario (un miembro cae en la Bandeja).
  await requireOwnerPage();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 md:px-6 md:py-4">
        <h2 className="font-semibold">Métricas</h2>
        <p className="text-sm text-muted-foreground">
          Cuántos mensajes entran por cada canal y cómo responde el agente.
          Solo la ve el propietario.
        </p>
      </header>
      <div className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        <MetricsClient />
      </div>
    </div>
  );
}
