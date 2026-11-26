import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  forwardability,
  forwardCaption,
  forwardFileName,
  summarizeForward,
  type ForwardKind,
  type ForwardResult,
  type ForwardTargetResult,
} from "@/lib/forward";
import { friendlyDeliveryError } from "@/lib/meta-errors";
import { validateOutboundFile } from "@/lib/outbound-media";
import { sendText } from "@/server/inbox/send";
import { sendContacts } from "@/server/inbox/send-contacts";
import { SendError } from "@/server/inbox/send-error";
import { channelOf, sendMedia } from "@/server/inbox/send-media";

/**
 * 054: reenviar mensajes de un chat a otros (como WhatsApp).
 *
 * No hay un camino de envío nuevo: cada mensaje reenviado sale por
 * `sendText`, `sendMedia` o `sendContacts`, con TODAS sus guardas (sandbox,
 * ventana, credenciales, formatos del canal) y marcado `details.forwarded`.
 * Acá solo se decide QUÉ se manda a QUIÉN y se junta el resultado por chat.
 *
 * El recorrido es mensaje → destinos (no destino → mensajes): cada chat
 * recibe los mensajes en su orden original, y de un adjunto hay un solo
 * binario en memoria a la vez, que a WhatsApp se sube una sola vez.
 */

export class ForwardError extends Error {
  status: 404 | 409 | 422;
  code: "not_found" | "not_forwardable" | "invalid_target";
  constructor(status: ForwardError["status"], code: ForwardError["code"], message: string) {
    super(message);
    this.name = "ForwardError";
    this.status = status;
    this.code = code;
  }
}

/** Errores que valen para TODO lo que le falte mandar a ese chat. */
const TARGET_BLOCKING: ReadonlySet<SendError["code"]> = new Set([
  "sandbox_violation",
  "window_closed",
  "not_connected",
  "reconnect_required",
  "opted_out",
  "meta_unavailable",
]);

type SourceRow = {
  message: typeof schema.message.$inferSelect;
  mediaId: string | null;
  mediaMime: string | null;
  mediaFileName: string | null;
  mediaDuration: number | null;
  kind: ForwardKind;
};

type TargetState = ForwardTargetResult & {
  kind: "whatsapp" | "instagram";
  /** Un error que corta el resto de los mensajes para este chat. */
  blocked: boolean;
};

export async function forwardMessages(input: {
  organizationId: string;
  sourceConversationId: string;
  messageIds: string[];
  targetConversationIds: string[];
  sentByUserId: string | null;
}): Promise<ForwardResult> {
  const { organizationId } = input;
  const db = getDb();

  // --- Origen: una conversación real de la empresa.
  const sourceRows = await db
    .select({ kind: schema.conversation.kind, isTest: schema.conversation.isTest })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, input.sourceConversationId)
      )
    )
    .limit(1);
  const source = sourceRows[0];
  if (!source) throw new ForwardError(404, "not_found", "Conversación no encontrada");
  if (source.isTest || !channelOf(source.kind)) {
    throw new ForwardError(
      422,
      "not_forwardable",
      "Los mensajes de esta conversación no se pueden reenviar"
    );
  }

  // --- Mensajes: todos de ESE chat, en el orden del hilo.
  const messageIds = [...new Set(input.messageIds)];
  const rows = await db
    .select({
      message: schema.message,
      mediaId: schema.messageMedia.id,
      mediaMime: schema.messageMedia.mimeType,
      mediaFileName: schema.messageMedia.fileName,
      mediaDuration: schema.messageMedia.durationMs,
    })
    .from(schema.message)
    .leftJoin(schema.messageMedia, eq(schema.messageMedia.messageId, schema.message.id))
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, input.sourceConversationId),
        inArray(schema.message.id, messageIds)
      )
    )
    .orderBy(schema.message.createdAt, schema.message.id);
  if (rows.length !== messageIds.length) {
    throw new ForwardError(404, "not_found", "Alguno de los mensajes ya no existe");
  }
  const sources: SourceRow[] = rows.map((r) => {
    const verdict = forwardability({
      type: r.message.type,
      text: r.message.text,
      hasMedia: r.mediaId !== null,
      mediaState: r.message.mediaState,
      contacts: r.message.details?.contacts ?? null,
    });
    if (!verdict.ok) throw new ForwardError(422, "not_forwardable", verdict.reason);
    return { ...r, kind: verdict.kind };
  });

  // --- Destinos: chats reales de la empresa (el resto de las guardas —
  // ventana, credenciales— las aplica cada envío).
  const targetIds = [...new Set(input.targetConversationIds)];
  const targetRows = await db
    .select({
      id: schema.conversation.id,
      kind: schema.conversation.kind,
      isTest: schema.conversation.isTest,
      name: schema.contact.name,
    })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        inArray(schema.conversation.id, targetIds)
      )
    );
  const targets: TargetState[] = targetIds.map((id) => {
    const row = targetRows.find((t) => t.id === id);
    if (!row) throw new ForwardError(404, "not_found", "Alguno de los chats ya no existe");
    const kind = channelOf(row.kind);
    if (row.isTest || !kind) {
      throw new ForwardError(
        422,
        "invalid_target",
        `No se puede reenviar a ${row.name}: no es un chat con un cliente`
      );
    }
    return { conversationId: id, name: row.name, kind, sent: 0, failed: 0, error: null, blocked: false };
  });

  for (const src of sources) {
    // El binario se carga recién acá y se suelta al pasar al mensaje siguiente.
    const bytes = src.kind === "media" ? await loadBytes(organizationId, src.mediaId!) : null;
    const uploadCache = new Map<string, string>();
    for (const target of targets) {
      if (target.blocked) {
        target.failed += 1;
        continue;
      }
      try {
        await forwardOne({
          organizationId,
          src,
          bytes,
          target,
          uploadCache,
          sentByUserId: input.sentByUserId,
        });
        target.sent += 1;
      } catch (err) {
        if (!(err instanceof SendError)) throw err;
        target.failed += 1;
        target.error ??= friendlyDeliveryError(err.message) ?? err.message;
        if (TARGET_BLOCKING.has(err.code)) target.blocked = true;
      }
    }
  }

  return summarizeForward(
    targets.map(({ conversationId, name, sent, failed, error }) => ({
      conversationId,
      name,
      sent,
      failed,
      error,
    }))
  );
}

async function loadBytes(organizationId: string, mediaId: string): Promise<Buffer | null> {
  const rows = await getDb()
    .select({ data: schema.messageMedia.data })
    .from(schema.messageMedia)
    .where(
      scoped(schema.messageMedia.organizationId, organizationId, eq(schema.messageMedia.id, mediaId))
    )
    .limit(1);
  return rows[0]?.data ?? null;
}

async function forwardOne(input: {
  organizationId: string;
  src: SourceRow;
  bytes: Buffer | null;
  target: TargetState;
  uploadCache: Map<string, string>;
  sentByUserId: string | null;
}): Promise<void> {
  const { organizationId, src, target } = input;
  const conversationId = target.conversationId;
  const details = { forwarded: true } as const;

  if (src.kind === "text") {
    await sendText({
      organizationId,
      conversationId,
      text: src.message.text!.trim(),
      sentByUserId: input.sentByUserId,
      details,
    });
    return;
  }

  if (src.kind === "contacts") {
    await sendContacts({
      organizationId,
      conversationId,
      contacts: src.message.details?.contacts ?? [],
      sentByUserId: input.sentByUserId,
      forwarded: true,
    });
    return;
  }

  if (!input.bytes) {
    throw new SendError("meta_error", "El archivo ya no está guardado en el CRM");
  }
  // El archivo se valida contra el canal de DESTINO: lo que llegó por
  // Instagram puede no entrar por WhatsApp (y al revés).
  const valid = validateOutboundFile(
    input.bytes,
    forwardFileName(src.message.type, src.mediaFileName),
    target.kind
  );
  if (!valid.ok) throw new SendError("meta_error", valid.error);
  await sendMedia({
    organizationId,
    conversationId,
    sentByUserId: input.sentByUserId,
    file: {
      bytes: input.bytes,
      kind: valid.kind,
      mime: valid.mime,
      fileName: valid.fileName,
      // Un OGG/Opus viaja como nota de voz, igual que el original.
      voice: valid.kind === "audio" && valid.mime === "audio/ogg",
      durationMs: valid.kind === "audio" ? src.mediaDuration : null,
    },
    caption: forwardCaption({
      type: src.message.type,
      text: src.message.text,
      fileName: src.mediaFileName,
    }),
    // La transcripción del audio se copia: no se vuelve a pagar por ella.
    transcript: src.message.type === "audio" ? src.message.text : null,
    details,
    uploadCache: input.uploadCache,
  });
}
