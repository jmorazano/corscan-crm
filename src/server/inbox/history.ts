import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { normalizeToWaId } from "@/lib/phone";
import {
  HISTORY_DECLINED_CODE,
  HISTORY_IMPORT_DEFAULT_DAYS,
  isValidThreadId,
  isWithinDays,
  mapEchoMessage,
  mapHistoryMessage,
  shouldAdoptAddressBookName,
  textOf,
  type HistoryRow,
} from "@/lib/history-import";
import { publish } from "@/server/events/bus";
import {
  getOrCreateContact,
  getOrCreateConversation,
  serializeMessage,
} from "@/server/inbox/ingest";
import type { WebhookValue } from "@/server/inbox/webhook";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";
import {
  getHistoryImport,
  recordChunk,
  recordDeclined,
} from "@/server/whatsapp/history-sync";

/**
 * Ingesta del historial del celular y de los ecos (017, coexistence).
 *
 * Camino PROPIO, distinto de `ingestInboundMessage`: un mensaje importado no
 * es un entrante nuevo — no suma no leídos, no crea leads, no evalúa BAJA,
 * no notifica push ni dispara al agente. Se inserta con `created_at` = fecha
 * original (el hilo, el preview y el cursor quedan en orden) y las marcas
 * de la conversación solo avanzan (`greatest`).
 */

const BATCH = 200;

async function resolveOrg(value: WebhookValue) {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return null;
  const creds = await getCredentialsByPhoneNumberId(phoneNumberId);
  if (!creds) {
    console.warn(`[historial] phone_number_id desconocido: ${phoneNumberId}`);
    return null;
  }
  return creds;
}

/**
 * Inserta filas de un hilo (dedup por wamid) y avanza las marcas.
 * Historial: `created_at` = fecha original (orden cronológico del hilo).
 * Ecos: `created_at` = ahora — son mensajes en vivo y el `timestamp` de Meta
 * viene en segundos: truncado podía quedar ANTES del entrante recién
 * ingerido (con milisegundos) y el agente veía «último = cliente».
 */
async function insertRows(
  organizationId: string,
  conversationId: string,
  rows: HistoryRow[],
  source: "history" | "phone"
): Promise<{ inserted: (typeof schema.message.$inferSelect)[] }> {
  const db = getDb();
  const inserted: (typeof schema.message.$inferSelect)[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const res = await db
      .insert(schema.message)
      .values(
        slice.map((r) => ({
          id: newId("message"),
          organizationId,
          conversationId,
          waMessageId: r.waMessageId,
          direction: r.direction,
          type: r.type,
          text: r.text,
          status: r.status,
          aiGenerated: false,
          source,
          waTimestamp: r.at,
          createdAt: source === "phone" ? new Date() : r.at,
        }))
      )
      .onConflictDoNothing({
        target: [schema.message.organizationId, schema.message.waMessageId],
      })
      .returning();
    inserted.push(...res);
  }
  if (inserted.length > 0) {
    const maxAll = new Date(Math.max(...inserted.map((m) => m.createdAt.getTime())));
    const inbound = inserted.filter((m) => m.direction === "in");
    const maxIn = inbound.length
      ? new Date(Math.max(...inbound.map((m) => m.createdAt.getTime())))
      : null;
    await db
      .update(schema.conversation)
      .set({
        lastMessageAt: sql`greatest(coalesce(${schema.conversation.lastMessageAt}, to_timestamp(0)), ${maxAll.toISOString()}::timestamp)`,
        ...(maxIn
          ? {
              lastInboundAt: sql`greatest(coalesce(${schema.conversation.lastInboundAt}, to_timestamp(0)), ${maxIn.toISOString()}::timestamp)`,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.conversation.id, conversationId));
  }
  return { inserted };
}

/**
 * Webhook `history`: chunks de hilos (o el error de rechazo). Un webhook
 * puede traer miles de mensajes: se procesa por hilo y en lotes.
 */
export async function processHistoryValue(value: WebhookValue): Promise<void> {
  const creds = await resolveOrg(value);
  if (!creds) return;
  const organizationId = creds.organizationId;

  // Detalle de media de un placeholder (mismo field, `messages[]`).
  if (!value.history?.length && value.messages?.length) {
    await applyMediaDetails(organizationId, value.messages);
    return;
  }

  const importRow = await getHistoryImport(organizationId);
  const days = importRow?.days ?? HISTORY_IMPORT_DEFAULT_DAYS;
  const now = new Date();

  for (const chunk of value.history ?? []) {
    const declined = chunk.errors?.[0];
    if (declined) {
      const code = String(declined.code ?? "");
      const message =
        Number(declined.code) === HISTORY_DECLINED_CODE
          ? "El negocio tiene desactivado compartir el historial en la app de WhatsApp Business (Ajustes → Herramientas → Compartir historial). Activalo y volvé a pedir la importación."
          : declined.message ?? declined.title ?? "Meta no pudo sincronizar el historial";
      await recordDeclined(organizationId, code, message);
      continue;
    }

    let imported = 0;
    let skippedOld = 0;
    let threads = 0;
    const touched: string[] = [];
    for (const thread of chunk.threads ?? []) {
      if (!isValidThreadId(thread.id)) continue;
      const rows: HistoryRow[] = [];
      for (const m of thread.messages ?? []) {
        const row = mapHistoryMessage(m, thread.id);
        if (!row) continue;
        if (!isWithinDays(row.at, days, now)) {
          skippedOld++;
          continue;
        }
        rows.push(row);
      }
      if (rows.length === 0) continue;
      try {
        const { contact } = await getOrCreateContact(organizationId, thread.id);
        const conversation = await getOrCreateConversation(organizationId, contact.id);
        const { inserted } = await insertRows(organizationId, conversation.id, rows, "history");
        imported += inserted.length;
        if (inserted.length > 0) {
          threads++;
          touched.push(conversation.id);
        }
      } catch (err) {
        console.error(
          `[historial] hilo ${thread.id} falló; se continúa:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    await recordChunk(organizationId, {
      progress: chunk.metadata?.progress ?? null,
      imported,
      skippedOld,
      threads,
    });
    console.info(
      `[historial] org ${organizationId}: chunk ${chunk.metadata?.chunk_order ?? "?"} fase ${chunk.metadata?.phase ?? "?"} → ${imported} mensajes, ${skippedOld} fuera de los ${days} días, progreso ${chunk.metadata?.progress ?? "?"}%`
    );
    if (touched.length > 0) {
      publish(organizationId, { type: "conversations.updated", data: { conversationIds: touched } });
    }
  }
}

/** Segundo webhook de media: completa tipo y pie del placeholder. */
async function applyMediaDetails(
  organizationId: string,
  messages: NonNullable<WebhookValue["messages"]>
): Promise<void> {
  const db = getDb();
  const ids = messages.map((m) => m.id).filter(Boolean);
  if (ids.length === 0) return;
  const existing = await db
    .select({ id: schema.message.id, waMessageId: schema.message.waMessageId, conversationId: schema.message.conversationId })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        inArray(schema.message.waMessageId, ids)
      )
    );
  const touched = new Set<string>();
  for (const m of messages) {
    const row = existing.find((e) => e.waMessageId === m.id);
    if (!row) continue;
    await db
      .update(schema.message)
      .set({ type: m.type, text: textOf(m) })
      .where(eq(schema.message.id, row.id));
    touched.add(row.conversationId);
  }
  if (touched.size > 0) {
    publish(organizationId, { type: "conversations.updated", data: { conversationIds: [...touched] } });
  }
}

/**
 * Webhook `smb_message_echoes`: lo que el negocio mandó desde la app del
 * celular. Saliente en vivo; sin agente (el negocio ya habló).
 */
export async function processEchoesValue(value: WebhookValue): Promise<void> {
  const creds = await resolveOrg(value);
  if (!creds) return;
  const organizationId = creds.organizationId;
  const byRecipient = new Map<string, HistoryRow[]>();
  for (const m of value.message_echoes ?? []) {
    const row = mapEchoMessage(m);
    if (!row || !isValidThreadId(m.to)) continue;
    const list = byRecipient.get(m.to!) ?? [];
    list.push(row);
    byRecipient.set(m.to!, list);
  }
  for (const [to, rows] of byRecipient) {
    try {
      const { contact } = await getOrCreateContact(organizationId, to);
      const conversation = await getOrCreateConversation(organizationId, contact.id);
      const { inserted } = await insertRows(organizationId, conversation.id, rows, "phone");
      for (const message of inserted) {
        publish(organizationId, {
          type: "message.new",
          data: { conversationId: conversation.id, message: serializeMessage(message) },
        });
      }
      if (inserted.length > 0) {
        publish(organizationId, {
          type: "conversations.updated",
          data: { conversationIds: [conversation.id] },
        });
      }
    } catch (err) {
      console.error(`[historial] eco a ${to} falló:`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Webhook `smb_app_state_sync`: nombres de la agenda del celular. Solo
 * renombra contactos cuyo nombre es el teléfono o el perfil de WhatsApp.
 */
export async function processStateSyncValue(value: WebhookValue): Promise<void> {
  const creds = await resolveOrg(value);
  if (!creds) return;
  const organizationId = creds.organizationId;
  const db = getDb();
  let renamed = 0;
  for (const item of value.state_sync ?? []) {
    if (item.type && item.type !== "contact") continue;
    if ((item.action ?? "").toLowerCase() === "remove") continue;
    const phoneRaw = item.contact?.phone_number ?? "";
    const name = (item.contact?.full_name ?? item.contact?.first_name ?? "").trim();
    if (!phoneRaw || !name) continue;
    const norm = normalizeToWaId(phoneRaw);
    if (!norm.ok) continue;
    const rows = await db
      .select({
        id: schema.contact.id,
        name: schema.contact.name,
        phone: schema.contact.phone,
        consentSource: schema.contact.consentSource,
        isTest: schema.contact.isTest,
      })
      .from(schema.contact)
      .where(
        and(
          eq(schema.contact.organizationId, organizationId),
          eq(schema.contact.phone, norm.waId)
        )
      )
      .limit(1);
    const contact = rows[0];
    if (!contact) {
      // La agenda suele llegar ANTES que el historial: se crea el contacto
      // (sin consentimiento → inelegible para campañas) para que el hilo,
      // cuando llegue, ya tenga su nombre.
      await getOrCreateContact(organizationId, norm.waId, name);
      renamed++;
      continue;
    }
    if (contact.isTest) continue;
    if (contact.name === name || !shouldAdoptAddressBookName(contact)) continue;
    await db
      .update(schema.contact)
      .set({ name, updatedAt: new Date() })
      .where(eq(schema.contact.id, contact.id));
    renamed++;
  }
  if (renamed > 0) {
    console.info(`[historial] org ${organizationId}: ${renamed} contacto(s) con nombre de la agenda`);
    publish(organizationId, { type: "conversations.updated", data: { conversationIds: [] } });
  }
}
