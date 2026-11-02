import { eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { alertDue } from "@/lib/team-attention";
import { notifyWaiting } from "./alert";
import { getAttentionSettingsMany } from "./settings";
import { listOpenWaits, reconcileWait } from "./waits";

/**
 * 048: barrido de las esperas (cada minuto). Concilia las abiertas — una
 * respuesta, la vuelta del agente o el cierre de la ventana las cierra con
 * la hora real — y avisa a los propietarios de las que cumplieron los
 * minutos. El aviso es at-most-once: se RESERVA (`alerted_at`) antes de
 * enviar, así ni un reinicio ni dos réplicas lo mandan dos veces.
 */

const TICK_MS = 60_000;
/** Esperas por barrido: las más viejas primero; el resto, al minuto siguiente. */
const WAITS_PER_SWEEP = 200;

export type AttentionSweepResult = { reconciled: number; closed: number; alerted: number };

const globalForSweep = globalThis as unknown as {
  __voceroAttentionTicker?: ReturnType<typeof setInterval>;
  __voceroAttentionRunning?: boolean;
};

export function startAttentionTicker(): void {
  if (globalForSweep.__voceroAttentionTicker) return;
  const run = () => {
    void runAttentionSweep().catch((err) =>
      console.warn("[atención] el barrido falló:", err instanceof Error ? err.message : err)
    );
  };
  globalForSweep.__voceroAttentionTicker = setInterval(run, TICK_MS);
  globalForSweep.__voceroAttentionTicker.unref?.();
}

/** Un barrido completo. `now` se inyecta en las pruebas (ruta de dev). */
export async function runAttentionSweep(now: Date = new Date()): Promise<AttentionSweepResult> {
  const result: AttentionSweepResult = { reconciled: 0, closed: 0, alerted: 0 };
  if (globalForSweep.__voceroAttentionRunning) return result;
  globalForSweep.__voceroAttentionRunning = true;
  try {
    const open = await listOpenWaits(WAITS_PER_SWEEP);
    if (open.length === 0) return result;
    const settings = await getAttentionSettingsMany(open.map((w) => w.organizationId));

    for (const row of open) {
      try {
        const wait = await reconcileWait(row, now);
        result.reconciled += 1;
        if (wait.status !== "open") {
          result.closed += 1;
          continue;
        }
        const config = settings.get(wait.organizationId);
        if (!config || !alertDue(wait, config, now)) continue;

        // Reserva-primero: solo quien la gana avisa.
        const [reserved] = await getDb()
          .update(schema.attentionWait)
          .set({ alertedAt: now, updatedAt: new Date() })
          .where(
            scoped(
              schema.attentionWait.organizationId,
              wait.organizationId,
              eq(schema.attentionWait.id, wait.id),
              eq(schema.attentionWait.status, "open"),
              isNull(schema.attentionWait.alertedAt)
            )
          )
          .returning();
        if (!reserved) continue;
        const minutes = Math.max(
          config.alertMinutes,
          Math.floor((now.getTime() - wait.startedAt.getTime()) / 60_000)
        );
        await notifyWaiting(reserved, minutes);
        result.alerted += 1;
      } catch (err) {
        console.error(
          `[atención] espera ${row.id}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    return result;
  } finally {
    globalForSweep.__voceroAttentionRunning = false;
  }
}
