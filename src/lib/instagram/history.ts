import type { IgHistoryMessage, IgParticipant } from "@/lib/instagram/client";
import { messageTypeFor } from "@/lib/instagram/webhook";

/**
 * Reglas PURAS de la importación del historial de Instagram (023): mismo
 * contrato que el historial del celular de WhatsApp (017) — fecha original,
 * ventana de días, sin no leídos ni agente —, adaptado a la Conversations
 * API (solo los 20 mensajes más recientes de cada conversación).
 */

export const INSTAGRAM_HISTORY_DAYS = 60;
/** Tope de conversaciones por importación (cuentas enormes no bloquean el proceso). */
export const INSTAGRAM_HISTORY_MAX_CONVERSATIONS = 500;
/** Una importación `running` más vieja que esto se considera colgada. */
export const INSTAGRAM_HISTORY_STALE_MS = 30 * 60 * 1000;

/** Fechas de Meta: ISO con `+0000` (sin dos puntos) o epoch. */
export function parseMetaTime(value: string | number | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const n = Number(value);
    return new Date(n < 1e12 ? n * 1000 : n);
  }
  const iso = String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** El cliente de una conversación: el participante que no es la cuenta. */
export function customerOf(
  participants: IgParticipant[],
  account: { igUserId: string; username: string | null }
): IgParticipant | null {
  const others = participants.filter(
    (p) =>
      p.id !== account.igUserId &&
      !(account.username && p.username?.toLowerCase() === account.username.toLowerCase())
  );
  // Conversaciones de grupo no existen en Instagram Direct para empresas;
  // si llegaran varios, no se adivina.
  return others.length === 1 ? others[0]! : null;
}

export type InstagramHistoryRow = {
  waMessageId: string;
  direction: "in" | "out";
  type: string;
  text: string | null;
  status: "delivered" | "sent";
  at: Date;
};

/**
 * Mensaje del historial → fila del CRM. `null` si no tiene fecha, queda
 * fuera de la ventana o no tiene nada que mostrar.
 */
export function mapInstagramHistoryMessage(
  m: IgHistoryMessage,
  ctx: { customerId: string; days: number; now: Date }
): InstagramHistoryRow | null {
  const at = parseMetaTime(m.createdTime);
  if (!at) return null;
  if (ctx.now.getTime() - at.getTime() > ctx.days * 86_400_000) return null;
  const direction = m.from?.id === ctx.customerId ? "in" : "out";
  const type = messageTypeFor({
    text: m.text,
    attachments: m.attachments,
    isUnsupported: m.isUnsupported,
  });
  if (type === "text" && !m.text) return null;
  return {
    waMessageId: m.id,
    direction,
    type,
    text: m.text,
    status: direction === "in" ? "delivered" : "sent",
    at,
  };
}
