import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isPaymentReceiptSummary, PAYMENT_RECEIPT_TAG } from "@/lib/payment-receipt-tag";
import { publish } from "@/server/events/bus";

/**
 * Etiqueta la conversación cuando el cliente manda un comprobante de pago
 * (049), si la empresa lo activó. Corre en la ingesta del adjunto: nunca lanza,
 * porque una etiqueta no puede dejar mudo al agente.
 *
 * `confirmed`: la lectura completa de la planilla (034) ya dijo que lo es, así
 * que no depende de cómo quedó redactada la descripción.
 */
export async function tagIfPaymentReceipt(input: {
  organizationId: string;
  conversationId: string;
  summary: string;
  confirmed: boolean;
}): Promise<void> {
  try {
    if (!input.confirmed && !isPaymentReceiptSummary(input.summary)) return;

    const db = getDb();
    const profile = await db
      .select({ enabled: schema.agentProfile.tagPaymentReceipts })
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, input.organizationId))
      .limit(1);
    if (!profile[0]?.enabled) return;

    const tagged = await db
      .update(schema.conversation)
      .set({
        tags: sql`(select array(select distinct unnest(${schema.conversation.tags} || array[${PAYMENT_RECEIPT_TAG}]::text[])))`,
        updatedAt: new Date(),
      })
      .where(
        scoped(
          schema.conversation.organizationId,
          input.organizationId,
          and(
            eq(schema.conversation.id, input.conversationId),
            eq(schema.conversation.isTest, false),
            sql`not (${PAYMENT_RECEIPT_TAG} = any(${schema.conversation.tags}))`
          )
        )
      )
      .returning({ id: schema.conversation.id });
    if (tagged.length === 0) return;

    publish(input.organizationId, {
      type: "conversations.updated",
      data: { conversationIds: [input.conversationId] },
    });
  } catch (err) {
    console.warn(
      `[medios] no se pudo etiquetar el comprobante en ${input.conversationId}:`,
      err instanceof Error ? err.message : err
    );
  }
}
