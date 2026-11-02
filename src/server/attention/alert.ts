import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { brandIcon, notifyOrganization } from "@/server/push/events";
import { buildWaitingPayload } from "@/server/push/payload";
import type { WaitRow } from "./waits";

/**
 * 048: «<cliente> espera hace N min» a los dispositivos de los PROPIETARIOS
 * de la empresa (sin importar el modo del dispositivo: el aviso es del
 * dueño). Lo llama solo quien ganó la reserva del barrido. Nunca lanza.
 */
export async function notifyWaiting(wait: WaitRow, minutes: number): Promise<number> {
  try {
    const db = getDb();
    const owners = await db
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(scoped(schema.member.organizationId, wait.organizationId, eq(schema.member.role, "owner")));
    const ownerIds = new Set(owners.map((o) => o.userId));
    if (ownerIds.size === 0) return 0;

    const [conversation] = await db
      .select({ contactName: schema.contact.name })
      .from(schema.conversation)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
      .where(
        scoped(
          schema.conversation.organizationId,
          wait.organizationId,
          eq(schema.conversation.id, wait.conversationId)
        )
      )
      .limit(1);
    if (!conversation) return 0;

    // Lo último que escribió el cliente (en una derivación puede no haber
    // nada nuevo: el texto lo dice).
    const [last] = await db
      .select({ type: schema.message.type, text: schema.message.text, createdAt: schema.message.createdAt })
      .from(schema.message)
      .where(
        and(
          scoped(
            schema.message.organizationId,
            wait.organizationId,
            eq(schema.message.conversationId, wait.conversationId),
            eq(schema.message.direction, "in")
          )
        )
      )
      .orderBy(desc(schema.message.createdAt))
      .limit(1);
    const fresh = last && last.createdAt.getTime() >= wait.startedAt.getTime() - 1_000;

    const payload = buildWaitingPayload({
      contactName: conversation.contactName,
      conversationId: wait.conversationId,
      waitId: wait.id,
      minutes,
      lastType: fresh || wait.startReason === "ai_off" ? (last?.type ?? null) : null,
      lastText: fresh || wait.startReason === "ai_off" ? (last?.text ?? null) : null,
      icon: await brandIcon(wait.organizationId),
    });
    const results = await notifyOrganization(wait.organizationId, payload, (sub) =>
      ownerIds.has(sub.userId)
    );
    return results.filter((r) => r.ok).length;
  } catch (err) {
    console.error("[atención] no se pudo avisar:", err instanceof Error ? err.message : err);
    return 0;
  }
}
