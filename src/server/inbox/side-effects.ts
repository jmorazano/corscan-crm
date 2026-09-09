import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Side-effects de un inbound REAL (004): corre desde ingestInboundMessage
 * DESPUÉS del gate de idempotencia por wamid — todo lo de acá hereda el
 * exactamente-una-vez. Cada escritura es además set-si-null / re-ejecutable
 * por sí misma (Constitución IV): una re-entrega no cambia nada.
 */

/** Palabras de baja: coincidencia EXACTA del mensaje completo (FR-010). */
const OPT_OUT_KEYWORDS = new Set(["BAJA", "STOP"]);

export function isOptOutMessage(type: string, text: string | null): boolean {
  if (type !== "text" || !text) return false;
  return OPT_OUT_KEYWORDS.has(text.trim().toUpperCase());
}

export async function onInboundSideEffects(input: {
  organizationId: string;
  contactId: string;
  messageType: string;
  text: string | null;
  at: Date;
}): Promise<void> {
  const db = getDb();
  const { organizationId, contactId } = input;

  // FR-007: el cliente que escribe consintió la conversación — fuente
  // "inbound", solo si no había registro previo (jamás pisa import/manual).
  await db
    .update(schema.contact)
    .set({ consentSource: "inbound", consentAt: input.at })
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.id, contactId),
        isNull(schema.contact.consentSource)
      )
    );

  if (isOptOutMessage(input.messageType, input.text)) {
    // FR-010: baja automática, set-si-null (la fecha original se conserva
    // ante re-entregas) …
    await db
      .update(schema.contact)
      .set({ optedOutAt: input.at, updatedAt: new Date() })
      .where(
        and(
          eq(schema.contact.organizationId, organizationId),
          eq(schema.contact.id, contactId),
          isNull(schema.contact.optedOutAt)
        )
      );
    // … y los envíos de campaña PENDIENTES del contacto se omiten.
    await db
      .update(schema.campaignRecipient)
      .set({ status: "skipped", skipReason: "opted_out" })
      .where(
        and(
          eq(schema.campaignRecipient.organizationId, organizationId),
          eq(schema.campaignRecipient.contactId, contactId),
          eq(schema.campaignRecipient.status, "pending")
        )
      );

    // 011 (FR-005): la baja ordena el pipeline — el lead pasa a la etapa
    // "perdido" de SU empresa. Sin lead o sin etapa lost: no-op (idempotente:
    // re-aplicar deja el mismo estado). La reversión es manual: el lead no
    // vuelve solo.
    const lostStage = await db
      .select({ id: schema.pipelineStage.id })
      .from(schema.pipelineStage)
      .where(
        and(
          eq(schema.pipelineStage.organizationId, organizationId),
          eq(schema.pipelineStage.kind, "lost")
        )
      )
      .limit(1);
    if (lostStage[0]) {
      await db
        .update(schema.lead)
        .set({
          stageId: lostStage[0].id,
          updatedAt: new Date(),
          lastActivityAt: input.at,
        })
        .where(
          and(
            eq(schema.lead.organizationId, organizationId),
            eq(schema.lead.contactId, contactId)
          )
        );
    }
  }

  // FR-017: "respondió" = cualquier inbound posterior al envío de la
  // campaña; set-si-null sobre los ya enviados.
  await db
    .update(schema.campaignRecipient)
    .set({ repliedAt: input.at })
    .where(
      and(
        eq(schema.campaignRecipient.organizationId, organizationId),
        eq(schema.campaignRecipient.contactId, contactId),
        eq(schema.campaignRecipient.status, "sent"),
        isNull(schema.campaignRecipient.repliedAt)
      )
    );
}
