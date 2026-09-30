import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { InstagramApiError, sendInstagramText } from "@/lib/instagram/client";
import {
  igsidFromPhone,
  instagramSendMode,
  splitInstagramText,
} from "@/lib/instagram/messaging";
import { isInstagramHumanAgentEnabled } from "@/lib/env";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";
import { SendError } from "@/server/inbox/send-error";
import {
  ensureInstagramToken,
  getInstagramIntegration,
  markInstagramReconnectRequired,
} from "@/server/instagram/integration";

/**
 * Envío de texto por Instagram Direct (023). Lo llama `sendText` cuando la
 * conversación es `kind='instagram'` — la aserción del sandbox ya corrió.
 *
 * Como en WhatsApp, el mensaje sale PRIMERO y se registra después con el
 * `mid` que devuelve Instagram. Diferencia: Instagram manda un eco
 * (`is_echo`) de todo lo que envía la cuenta, incluso lo que mandó el CRM.
 * Si el eco gana la carrera, la fila ya existe como «Desde Instagram»: acá se
 * REASIGNA a `cloud` en vez de duplicarla.
 */
export async function sendInstagramConversationText(input: {
  organizationId: string;
  conversation: typeof schema.conversation.$inferSelect;
  contact: typeof schema.contact.$inferSelect;
  text: string;
  aiGenerated: boolean;
}): Promise<{ messageId: string }> {
  const { organizationId, conversation, contact } = input;

  const mode = instagramSendMode(conversation.lastInboundAt, {
    aiGenerated: input.aiGenerated,
    humanAgentEnabled: isInstagramHumanAgentEnabled(),
  });
  if (mode.mode === "closed") throw instagramWindowError(mode.reason);

  const igsid = igsidFromPhone(contact.phone);
  if (!igsid) {
    throw new SendError("meta_error", "El contacto no tiene un ID de Instagram");
  }

  let integration = await getInstagramIntegration(organizationId);
  if (!integration) {
    throw new SendError("not_connected", "No hay una cuenta de Instagram conectada");
  }
  integration = await ensureInstagramToken(integration);
  if (integration.status === "reconnect_required") {
    throw new SendError(
      "reconnect_required",
      "La conexión con Instagram venció: reconectá la cuenta en Ajustes → Instagram"
    );
  }

  const chunks = splitInstagramText(input.text);
  if (chunks.length === 0) {
    throw new SendError("meta_error", "El mensaje está vacío");
  }

  const db = getDb();
  let lastId: string | null = null;
  for (const chunk of chunks) {
    let mid: string;
    try {
      ({ messageId: mid } = await sendInstagramText({
        igUserId: integration.igUserId,
        token: integration.token,
        recipientId: igsid,
        text: chunk,
        humanAgent: mode.mode === "human_agent",
      }));
    } catch (err) {
      throw await toSendError(err, organizationId);
    }

    const now = new Date();
    const inserted = await db
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId,
        conversationId: conversation.id,
        waMessageId: mid,
        direction: "out",
        type: "text",
        text: chunk,
        // Instagram no avisa «entregado»: aceptado = enviado; el «visto»
        // llega por `messaging_seen`.
        status: "sent",
        aiGenerated: input.aiGenerated,
        waTimestamp: now,
      })
      .onConflictDoNothing({
        target: [schema.message.organizationId, schema.message.waMessageId],
      })
      .returning();

    let row = inserted[0];
    let event: "message.new" | "message.updated" = "message.new";
    if (!row) {
      // El eco llegó antes: la fila es nuestra, no «Desde Instagram».
      const updated = await db
        .update(schema.message)
        .set({ source: "cloud", aiGenerated: input.aiGenerated })
        .where(
          scoped(
            schema.message.organizationId,
            organizationId,
            eq(schema.message.waMessageId, mid)
          )
        )
        .returning();
      row = updated[0];
      event = "message.updated";
    }
    if (!row) continue;
    lastId = row.id;
    publish(organizationId, {
      type: event,
      data: { conversationId: conversation.id, message: serializeMessage(row) },
    });
  }

  await db
    .update(schema.conversation)
    .set({
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.conversation.id, conversation.id),
        eq(schema.conversation.organizationId, organizationId)
      )
    );

  return { messageId: lastId ?? "" };
}

/** 027: el motivo de una ventana cerrada, en castellano (texto y adjuntos). */
export function instagramWindowError(
  reason: "no_inbound" | "window" | "human_agent_expired" | "human_agent_unavailable"
): SendError {
  return new SendError(
    "window_closed",
    reason === "human_agent_expired"
      ? "Pasaron más de 7 días desde el último mensaje del cliente: Instagram no permite escribirle hasta que vuelva a escribir"
      : reason === "human_agent_unavailable"
        ? "Pasaron más de 24 h desde el último mensaje del cliente e Instagram todavía no habilitó responder hasta 7 días (falta que Meta apruebe el permiso «Human Agent» de la app)"
        : "La ventana de 24 horas de Instagram está cerrada"
  );
}

/** Traduce el error de Instagram al contrato de `SendError` (026: también
 * lo usa el envío de adjuntos). */
export async function toSendError(err: unknown, organizationId: string): Promise<SendError> {
  if (err instanceof SendError) return err;
  if (err instanceof InstagramApiError) {
    if (err.isAuthError) {
      await markInstagramReconnectRequired(organizationId);
      return new SendError(
        "reconnect_required",
        "La conexión con Instagram venció: reconectá la cuenta en Ajustes → Instagram"
      );
    }
    if (err.isUnavailable) {
      return new SendError("meta_unavailable", "Instagram no está disponible ahora");
    }
    return new SendError("meta_error", friendlyInstagramError(err));
  }
  return new SendError("meta_error", err instanceof Error ? err.message : String(err));
}

/**
 * Motivos frecuentes en castellano (el resto pasa el texto de Meta, ya sin
 * secretos). Códigos de la Send API de Instagram / Messenger.
 */
export function friendlyInstagramError(err: { code: number | null; subcode: number | null; message: string }): string {
  // 027: la etiqueta HUMAN_AGENT sin el permiso aprobado en el App Review.
  if (/human agent/i.test(err.message)) {
    return "Instagram todavía no aprobó el permiso «Human Agent» de la app: solo se puede responder dentro de las 24 h del último mensaje del cliente";
  }
  if (err.code === 551 || err.subcode === 1545041) {
    return "Instagram: la persona no está disponible (bloqueó a la cuenta o la desactivó)";
  }
  if (err.code === 10 && err.subcode === 2018278) {
    return "Instagram: el mensaje quedó fuera de la ventana permitida";
  }
  if (err.code === 10 || err.code === 200) {
    return `Instagram rechazó el envío por permisos: ${err.message}`;
  }
  return `Instagram rechazó el envío: ${err.message}`;
}
