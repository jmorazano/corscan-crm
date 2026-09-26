/**
 * Hook de arranque de Next. El trabajo real vive en instrumentation-node.ts
 * (import dinámico condicionado al runtime para que el bundler edge no
 * intente resolver dependencias de Node como `postgres`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { cleanupOrphanRuns } = await import("./instrumentation-node");
    await cleanupOrphanRuns();
    const { backfillContactPhones } = await import(
      "./server/contacts-backfill"
    );
    await backfillContactPhones();
    // 004: las campañas en curso retoman solas (at-most-once) y el ticker
    // reanuda las pausadas por cupo cuando la ventana móvil libera.
    const { reviveCampaigns } = await import("./server/campaigns/runner");
    await reviveCampaigns();
    // 023: renovación en proceso de los tokens de Instagram (60 días). Sin
    // Instagram habilitado no hay filas y el barrido no hace nada.
    const { startInstagramTokenTicker } = await import("./server/instagram/integration");
    startInstagramTokenTicker();
  }
}
