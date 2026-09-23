import type { WebhookMessage } from "@/server/inbox/webhook";

/**
 * Reglas puras de la importación del historial del celular (017): mapeo de
 * un mensaje del webhook `history` a una fila de `message`, filtro de días
 * y utilidades de teléfono. Sin BD: testeable en Node.
 */

export const HISTORY_IMPORT_DEFAULT_DAYS = 60;
export const HISTORY_IMPORT_MAX_DAYS = 180;
/** Meta: el negocio desactivó compartir el historial en la app. */
export const HISTORY_DECLINED_CODE = 2593109;

export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export type HistoryRow = {
  waMessageId: string;
  direction: "in" | "out";
  type: string;
  text: string | null;
  status: MessageStatus;
  at: Date;
};

export function digitsOf(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

/** wa_id de un hilo: solo dígitos, largo razonable (nunca grupos ni vacíos). */
export function isValidThreadId(id: string | null | undefined): boolean {
  return /^\d{6,16}$/.test(id ?? "");
}

export function isWithinDays(at: Date, days: number, now = new Date()): boolean {
  return now.getTime() - at.getTime() <= days * 86_400_000;
}

/** Estado de entrega del historial → estado del CRM. */
export function statusFor(historyStatus: string | undefined, direction: "in" | "out"): MessageStatus {
  if (direction === "in") return "delivered";
  switch ((historyStatus ?? "").toUpperCase()) {
    case "READ":
    case "PLAYED":
      return "read";
    case "DELIVERED":
      return "delivered";
    case "SENT":
      return "sent";
    case "ERROR":
      return "failed";
    default:
      return "pending";
  }
}

const MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);
const OTHER_TYPES = new Set(["location", "contacts", "media_placeholder"]);

/** Texto visible de un mensaje (cuerpo o pie de media). */
export function textOf(m: WebhookMessage): string | null {
  if (m.type === "text") return m.text?.body ?? null;
  if (MEDIA_TYPES.has(m.type)) {
    const media = (m as unknown as Record<string, { caption?: string; filename?: string } | undefined>)[m.type];
    return media?.caption ?? media?.filename ?? null;
  }
  return null;
}

/**
 * Mapea un mensaje del historial. `threadId` es el número del cliente: si el
 * mensaje viene de él es entrante; si no, lo mandó el negocio. Tipos que el
 * hilo no sabe mostrar se descartan (null).
 */
export function mapHistoryMessage(m: WebhookMessage, threadId: string): HistoryRow | null {
  if (!m.id || !m.timestamp) return null;
  const n = Number(m.timestamp);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (!(m.type === "text" || MEDIA_TYPES.has(m.type) || OTHER_TYPES.has(m.type))) return null;
  const fromMe = m.history_context?.from_me;
  const direction: "in" | "out" =
    typeof fromMe === "boolean"
      ? fromMe
        ? "out"
        : "in"
      : digitsOf(m.from) === digitsOf(threadId)
        ? "in"
        : "out";
  return {
    waMessageId: m.id,
    direction,
    type: m.type,
    text: textOf(m),
    status: statusFor(m.history_context?.status, direction),
    at: new Date(n * 1000),
  };
}

/** Mapea un eco (`smb_message_echoes`): siempre saliente del negocio. */
export function mapEchoMessage(m: WebhookMessage): HistoryRow | null {
  if (!m.id || !m.to) return null;
  const n = Number(m.timestamp);
  const at = Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
  if (!(m.type === "text" || MEDIA_TYPES.has(m.type) || OTHER_TYPES.has(m.type))) return null;
  return {
    waMessageId: m.id,
    direction: "out",
    type: m.type,
    text: textOf(m),
    status: "sent",
    at,
  };
}

export function clampDays(days: unknown): number {
  const n = typeof days === "number" ? days : Number(days);
  if (!Number.isFinite(n)) return HISTORY_IMPORT_DEFAULT_DAYS;
  return Math.min(HISTORY_IMPORT_MAX_DAYS, Math.max(1, Math.trunc(n)));
}

/** ¿El nombre actual es "reemplazable" por el de la agenda del celular? */
export function shouldAdoptAddressBookName(contact: {
  name: string;
  phone: string;
  consentSource: string | null;
}): boolean {
  if (!contact.name.trim() || contact.name.trim() === contact.phone) return true;
  // Creado por un entrante: su nombre es el perfil de WhatsApp (elegido por el
  // cliente); el de la agenda del negocio es más útil. Importados/manuales/API
  // conservan lo que el operador cargó.
  return contact.consentSource === "inbound" || contact.consentSource === null;
}
