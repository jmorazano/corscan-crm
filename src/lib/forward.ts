import { z } from "zod";
import type { SharedContact } from "@/lib/contact-card";
import { OUTBOUND_KINDS, type OutboundKind } from "@/lib/outbound-media";
import { composerMode } from "@/lib/trainer";

/**
 * 054: reenviar mensajes de la Bandeja, PURO (lo comparten el hilo, el
 * diálogo y el servidor).
 *
 * Reenviar es mandar un mensaje NUEVO del equipo al chat de destino con el
 * contenido de otro: valen todas las reglas del envío común (ventana,
 * formatos del canal, sandbox). La Cloud API no deja marcarlo como
 * «reenviado» para el cliente; la marca vive en el CRM.
 */

/** Tope de WhatsApp: un reenvío llega a 5 chats como mucho. */
export const FORWARD_MAX_TARGETS = 5;
export const FORWARD_MAX_MESSAGES = 20;

export type ForwardKind = "text" | "media" | "contacts";

export type ForwardSource = {
  type: string;
  text: string | null;
  /** El binario está guardado en el CRM. */
  hasMedia: boolean;
  mediaState?: "pending" | "ready" | "failed" | null;
  contacts?: readonly SharedContact[] | null;
};

export type Forwardability =
  | { ok: true; kind: ForwardKind }
  | { ok: false; reason: string };

const NOT_FORWARDABLE: Record<string, string> = {
  sticker: "Los stickers no se pueden reenviar",
  reaction: "Una reacción no se puede reenviar",
  deleted: "El mensaje fue eliminado",
  comment: "Un comentario de Instagram no se puede reenviar",
  story: "Una historia de Instagram no se puede reenviar",
  share: "Una publicación compartida no se puede reenviar",
  location: "Las ubicaciones no se pueden reenviar",
  unsupported: "Instagram no deja abrir este adjunto",
  media_placeholder: "Este archivo quedó en el celular: no está en el CRM",
};

const MEDIA_NOUN: Record<OutboundKind, string> = {
  image: "La imagen",
  video: "El video",
  audio: "El audio",
  document: "El documento",
};

/** ¿Se puede reenviar este mensaje? Si no, por qué (en castellano). */
export function forwardability(m: ForwardSource): Forwardability {
  if (m.type === "text" || m.type === "template") {
    return m.text?.trim()
      ? { ok: true, kind: "text" }
      : { ok: false, reason: "El mensaje no tiene texto" };
  }
  if ((OUTBOUND_KINDS as readonly string[]).includes(m.type)) {
    if (m.hasMedia) return { ok: true, kind: "media" };
    const noun = MEDIA_NOUN[m.type as OutboundKind];
    return {
      ok: false,
      reason:
        m.mediaState === "pending"
          ? `${noun} todavía se está descargando`
          : `${noun} no está guardado en el CRM`,
    };
  }
  if (m.type === "contacts") {
    return (m.contacts?.length ?? 0) > 0 && m.contacts!.some((c) => c.phones.length > 0)
      ? { ok: true, kind: "contacts" }
      : { ok: false, reason: "La tarjeta no trae un teléfono para reenviar" };
  }
  return { ok: false, reason: NOT_FORWARDABLE[m.type] ?? "Este mensaje no se puede reenviar" };
}

/** Lo mismo desde el DTO del hilo. */
export function forwardabilityOfDto(m: {
  type: string;
  text: string | null;
  media: unknown | null;
  mediaState: "pending" | "ready" | "failed" | null;
  details: { contacts?: SharedContact[] } | null;
}): Forwardability {
  return forwardability({
    type: m.type,
    text: m.text,
    hasMedia: m.media !== null,
    mediaState: m.mediaState,
    contacts: m.details?.contacts ?? null,
  });
}

/**
 * El epígrafe que acompaña al adjunto reenviado. En un audio `text` es la
 * transcripción (no viaja como epígrafe) y un documento entrante sin
 * epígrafe trae su nombre en `text` (020).
 */
export function forwardCaption(m: {
  type: string;
  text: string | null;
  fileName: string | null;
}): string | null {
  const text = m.text?.trim() || null;
  if (!text || m.type === "audio") return null;
  if (m.type === "document" && m.fileName && text === m.fileName.trim()) return null;
  return text;
}

/** Nombre del archivo cuando el original no lo trae (una foto del cliente). */
export function forwardFileName(type: string, fileName: string | null): string {
  if (fileName?.trim()) return fileName.trim();
  return type === "image" ? "imagen" : type === "video" ? "video" : type === "audio" ? "audio" : "archivo";
}

/* ============================================================
 * Destinos
 * ============================================================ */

export type ForwardTargetState = { ok: true } | { ok: false; reason: string };

/** ¿Se le puede escribir a este chat ahora? (misma regla que el compositor). */
export function forwardTargetState(
  conversation: {
    kind?: "whatsapp" | "trainer" | "instagram";
    windowOpen: boolean;
    lastInboundAt?: string | null;
  },
  now: Date = new Date(),
  opts: { instagramHumanAgent?: boolean } = {}
): ForwardTargetState {
  const mode = composerMode(conversation, now, opts);
  if (mode === "text" || mode === "instagram_human") return { ok: true };
  if (mode === "template") {
    return { ok: false, reason: "Ventana de 24 h cerrada: necesita una plantilla" };
  }
  if (mode === "trainer") return { ok: false, reason: "Es la conversación con tu agente" };
  return { ok: false, reason: "Instagram no permite escribirle ahora" };
}

/** Agrega o quita un destino respetando el tope. `full` = no entró. */
export function toggleForwardTarget(
  selected: readonly string[],
  id: string
): { selected: string[]; full: boolean } {
  if (selected.includes(id)) return { selected: selected.filter((x) => x !== id), full: false };
  if (selected.length >= FORWARD_MAX_TARGETS) return { selected: [...selected], full: true };
  return { selected: [...selected, id], full: false };
}

/* ============================================================
 * Pedido y resultado
 * ============================================================ */

const idList = (max: number, what: string) =>
  z
    .array(z.string().min(1).max(64))
    .min(1, `Elegí al menos ${what}`)
    .max(max)
    .transform((ids) => [...new Set(ids)]);

/** Cuerpo de `POST /api/conversations/forward`. */
export const forwardInput = z.object({
  sourceConversationId: z.string().min(1).max(64),
  messageIds: idList(FORWARD_MAX_MESSAGES, "un mensaje"),
  targetConversationIds: idList(FORWARD_MAX_TARGETS, "un chat"),
});
export type ForwardInput = z.infer<typeof forwardInput>;

export type ForwardTargetResult = {
  conversationId: string;
  /** Nombre del contacto, para decir a quién no le llegó. */
  name: string;
  sent: number;
  failed: number;
  /** El primer motivo de fallo (ya en castellano). */
  error: string | null;
};

export type ForwardResult = {
  targets: ForwardTargetResult[];
  sent: number;
  failed: number;
};

export function summarizeForward(targets: ForwardTargetResult[]): ForwardResult {
  return {
    targets,
    sent: targets.reduce((n, t) => n + t.sent, 0),
    failed: targets.reduce((n, t) => n + t.failed, 0),
  };
}

/** El aviso corto tras reenviar («Reenviado a 3 chats»). */
export function forwardNotice(result: ForwardResult): string {
  const reached = result.targets.filter((t) => t.sent > 0);
  if (reached.length === 0) return "No se pudo reenviar";
  const where = reached.length === 1 ? `a ${reached[0]!.name}` : `a ${reached.length} chats`;
  return result.failed > 0 ? `Reenviado ${where}, con errores` : `Reenviado ${where}`;
}
