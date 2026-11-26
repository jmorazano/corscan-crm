import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  buildContactCard,
  contactCardText,
  sendableContacts,
  toWhatsAppContactsPayload,
  type ManualContactInput,
  type SharedContact,
} from "@/lib/contact-card";
import { normalizeToWaId } from "@/lib/phone";
import { publish } from "@/server/events/bus";
import { authorName } from "@/server/inbox/author";
import { serializeMessage } from "@/server/inbox/ingest";
import { callGraphSend, sendText } from "@/server/inbox/send";
import { SendError } from "@/server/inbox/send-error";
import { loadConversation, resolveTarget } from "@/server/inbox/send-media";

/**
 * 054: tarjetas de contacto que el equipo manda desde la Bandeja.
 *
 * WhatsApp las lleva como mensaje nativo (`type: "contacts"`); Instagram no
 * tiene tarjetas y salen como texto. Mismas guardas y mismo orden que el
 * resto de los envíos (`resolveTarget`): sandbox → canal → ventana →
 * credenciales, y nada se escribe hasta que Meta lo aceptó (como el texto).
 */
export async function sendContacts(input: {
  organizationId: string;
  conversationId: string;
  contacts: SharedContact[];
  sentByUserId?: string | null;
  /** Viene de otro chat (reenviar). */
  forwarded?: boolean;
}): Promise<{ messageId: string }> {
  const { organizationId, conversationId } = input;
  const cards = sendableContacts(input.contacts);
  if (cards.length === 0) {
    throw new SendError("meta_error", "La tarjeta no tiene un teléfono para enviar");
  }
  const { conversation, contact } = await loadConversation(organizationId, conversationId);

  if (conversation.kind === "instagram") {
    // `sendText` aplica las guardas (sandbox, ventana de Instagram, cuenta, token).
    return sendText({
      organizationId,
      conversationId,
      text: contactCardText(cards),
      sentByUserId: input.sentByUserId ?? null,
      details: input.forwarded ? { forwarded: true } : null,
    });
  }

  const target = await resolveTarget(organizationId, conversation, contact);
  if (target.channel !== "whatsapp") {
    throw new SendError("meta_error", "Esta conversación no admite tarjetas de contacto");
  }

  const { waMessageId } = await callGraphSend(target.credentials, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: target.to,
    type: "contacts",
    contacts: toWhatsAppContactsPayload(cards),
  });

  const db = getDb();
  const now = new Date();
  let inserted: (typeof schema.message.$inferSelect)[];
  try {
    inserted = await db
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId,
        conversationId,
        waMessageId,
        direction: "out",
        type: "contacts",
        text: null,
        status: "pending",
        aiGenerated: false,
        sentByUserId: input.sentByUserId ?? null,
        sentByName: await authorName(input.sentByUserId),
        details: { contacts: cards, ...(input.forwarded ? { forwarded: true } : {}) },
        waTimestamp: now,
      })
      .returning();
  } catch (err) {
    console.warn(
      `[send] tarjeta ${waMessageId} entregada pero sin registro local: ` +
        `la conversación ${conversationId} ya no existe`,
      err instanceof Error ? err.message : err
    );
    throw new SendError(
      "meta_error",
      "El contacto se envió pero la conversación fue borrada mientras tanto; no quedó registrado en el CRM"
    );
  }
  const message = inserted[0]!;
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(schema.conversation.id, conversationId));
  publish(organizationId, {
    type: "message.new",
    data: { conversationId, message: serializeMessage(message) },
  });
  return { messageId: message.id };
}

/**
 * Arma las tarjetas de un pedido de la Bandeja: contactos del CRM (por id,
 * de ESTA empresa, con teléfono real) y los que el equipo escribe a mano.
 * Devuelve `null` con el motivo si alguno no sirve — no se manda una tarjeta
 * a medias.
 */
export async function resolveContactCards(
  organizationId: string,
  input: { contactIds: string[]; manual: ManualContactInput[] }
): Promise<{ ok: true; cards: SharedContact[] } | { ok: false; error: string }> {
  const cards: SharedContact[] = [];
  const ids = [...new Set(input.contactIds)];
  if (ids.length > 0) {
    const rows = await getDb()
      .select({
        id: schema.contact.id,
        name: schema.contact.name,
        phone: schema.contact.phone,
        channel: schema.contact.channel,
        isTest: schema.contact.isTest,
      })
      .from(schema.contact)
      .where(scoped(schema.contact.organizationId, organizationId, inArray(schema.contact.id, ids)));
    for (const id of ids) {
      const row = rows.find((r) => r.id === id);
      if (!row) return { ok: false, error: "Uno de los contactos ya no existe" };
      // Instagram guarda un teléfono sintético (`ig:…`) y el Entrenador el
      // suyo: no son números que se puedan compartir.
      if (row.isTest || row.channel !== "whatsapp" || !/^\d{7,15}$/.test(row.phone)) {
        return { ok: false, error: `${row.name} no tiene un teléfono para compartir` };
      }
      const card = buildContactCard({ name: row.name, phone: row.phone, waId: row.phone });
      if (!card) return { ok: false, error: `${row.name} no tiene un teléfono para compartir` };
      cards.push(card);
    }
  }
  for (const m of input.manual) {
    const normalized = normalizeToWaId(m.phone);
    const card = buildContactCard({
      name: m.name,
      phone: m.phone,
      waId: normalized.ok ? normalized.waId : null,
    });
    if (!card) return { ok: false, error: `El teléfono de ${m.name} no es válido` };
    cards.push(card);
  }
  // El mismo número dos veces (elegido y escrito) viaja una sola vez.
  const seen = new Set<string>();
  const unique = cards.filter((c) => {
    const key = c.phones[0]!.waId ?? c.phones[0]!.phone.replace(/\D/g, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ok: true, cards: unique };
}
