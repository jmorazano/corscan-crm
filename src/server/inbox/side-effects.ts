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
    await applyOptOut({ organizationId, contactId, at: input.at, source: "keyword" });
  }

  // 042: si el cliente contesta, los seguimientos enviados quedan como
  // «contestó» (set-si-null, para el registro).
  await db
    .update(schema.agentFollowUp)
    .set({ repliedAt: input.at })
    .where(
      and(
        eq(schema.agentFollowUp.organizationId, organizationId),
        eq(schema.agentFollowUp.contactId, contactId),
        eq(schema.agentFollowUp.status, "sent"),
        isNull(schema.agentFollowUp.repliedAt)
      )
    );

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

/**
 * Baja del contacto (004/011), compartida por la palabra exacta de la
 * ingesta y, desde 042, por el agente («no me interesa, no me escribas»):
 * set-si-null (la fecha y el origen originales se conservan), los envíos de
 * campaña PENDIENTES se omiten y el lead pasa a la etapa «perdido» de su
 * empresa. Devuelve si la baja es nueva.
 */
export async function applyOptOut(input: {
  organizationId: string;
  contactId: string;
  at: Date;
  source: "keyword" | "agent";
}): Promise<boolean> {
  const db = getDb();
  const { organizationId, contactId } = input;
  const marked = await db
    .update(schema.contact)
    .set({ optedOutAt: input.at, optedOutSource: input.source, updatedAt: new Date() })
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.id, contactId),
        isNull(schema.contact.optedOutAt)
      )
    )
    .returning({ id: schema.contact.id });
  // Los envíos de campaña PENDIENTES del contacto se omiten.
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
        // 044: la baja no es «días sin respuesta»: no vuelve sola.
        staleLostAt: null,
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
  return marked.length > 0;
}
