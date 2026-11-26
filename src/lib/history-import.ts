import type { WebhookMessage } from "@/server/inbox/webhook";
import { parseWhatsAppContacts, type SharedContact } from "@/lib/contact-card";

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
  /** 054: tarjetas de contacto (`type: "contacts"`). */
  contacts?: SharedContact[];
};

/** 054: las tarjetas de un mensaje `contacts` (vacío si no trae ninguna legible). */
export function contactsOf(m: WebhookMessage): SharedContact[] | undefined {
  if (m.type !== "contacts") return undefined;
  const cards = parseWhatsAppContacts(m.contacts);
  return cards.length > 0 ? cards : undefined;
}

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
    contacts: contactsOf(m),
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
    contacts: contactsOf(m),
  };
}

export function clampDays(days: unknown): number {
  const n = typeof days === "number" ? days : Number(days);
  if (!Number.isFinite(n)) return HISTORY_IMPORT_DEFAULT_DAYS;
  return Math.min(HISTORY_IMPORT_MAX_DAYS, Math.max(1, Math.trunc(n)));
}

/**
 * ¿Se puede reemplazar el nombre actual del contacto por uno mejor?
 *
 * Lo usan los dos caminos que aprenden un nombre sin que nadie lo escriba a
 * mano: la sync de la agenda del celular (017) y el agente cuando el huésped
 * dice cómo se llama (021).
 *
 * La regla: manda SIEMPRE lo que cargó una persona del equipo.
 * - Nombre vacío o igual al teléfono → nunca hubo nombre: se reemplaza.
 * - `name_edited_at` con fecha → alguien del equipo lo corrigió a mano en el
 *   CRM: NO se toca. (021: sin este campo, un contacto nacido de un entrante
 *   seguía marcado `consent_source = 'inbound'` aunque el operador hubiera
 *   arreglado el nombre, y la sync de 017 se lo pisaba igual.)
 * - Creado por un entrante: el nombre es el del PERFIL de WhatsApp, que lo
 *   eligió el cliente; se reemplaza por uno más útil.
 * - Import / alta manual / API: lo cargó el operador, se conserva.
 */
export function canOverwriteContactName(contact: {
  name: string;
  phone: string;
  consentSource: string | null;
  nameEditedAt?: Date | null;
}): boolean {
  if (!contact.name.trim() || contact.name.trim() === contact.phone) return true;
  if (contact.nameEditedAt) return false;
  return contact.consentSource === "inbound" || contact.consentSource === null;
}

/* ------------------------------------------------------------------------ */
/* Estado de la importación: qué se muestra y cuándo tiene sentido pedirla   */
/* ------------------------------------------------------------------------ */

/**
 * Meta acepta UN pedido de sincronización por conexión del número. El segundo
 * responde `(#4) Application request limit reached: Synchronization Request
 * limit exceeded…` (visto el 26-nov-2026). Código propio: el 4 a secas es el
 * límite genérico de la app y no significa lo mismo.
 */
export const HISTORY_SYNC_LIMIT_CODE = "sync_limit";
/** Meta: el pedido llegó fuera de las 24 h del onboarding. */
export const HISTORY_TOO_LATE_CODE = "135000";
/**
 * Cuando la importación anda, el primer tramo llega en uno o dos minutos y
 * los siguientes cada pocos segundos. Pasado este tiempo sin novedades, Meta
 * no está mandando nada: se deja de mostrar como «en curso».
 */
export const HISTORY_STALLED_MS = 10 * 60_000;

export const HISTORY_SYNC_LIMIT_TEXT =
  "Meta permite pedir el historial una sola vez por conexión del número, y ese pedido ya se usó.";

export function isSyncLimitError(
  code: number | string | null | undefined,
  message: string | null | undefined
): boolean {
  return String(code ?? "") === "4" && /synchroni[sz]ation/i.test(message ?? "");
}

export type HistoryImportStatus =
  | "idle"
  | "requested"
  | "receiving"
  | "done"
  | "failed"
  | "declined";

export type HistoryImportState = {
  status: HistoryImportStatus;
  requestedAt: Date | null;
  lastChunkAt: Date | null;
  /** Última vez que se tocó la fila (pedido, tramo o error). */
  attemptAt: Date | null;
  lastErrorCode: string | null;
  lastError: string | null;
};

export type HistoryImportView = {
  kind:
    | "idle"
    | "waiting"
    | "stalled"
    | "receiving"
    | "paused"
    | "done"
    | "failed"
    | "declined";
  /** Motivo conocido por el que pedirla otra vez no sirve. */
  problem: "sync_limit" | "too_late" | null;
  /** ¿Se ofrece el botón de pedir la importación? */
  canRequest: boolean;
  /** El único camino es desconectar y volver a conectar el número. */
  needsReconnect: boolean;
};

function problemOf(row: HistoryImportState): HistoryImportView["problem"] {
  if (
    row.lastErrorCode === HISTORY_SYNC_LIMIT_CODE ||
    // Filas anteriores al arreglo: código y texto crudos de Meta.
    isSyncLimitError(row.lastErrorCode, row.lastError)
  ) {
    return "sync_limit";
  }
  if (row.lastErrorCode === HISTORY_TOO_LATE_CODE) return "too_late";
  return null;
}

/**
 * ¿El número se (re)conectó DESPUÉS de este momento? Entonces lo que se sabe
 * del pedido es de una conexión anterior y Meta admite uno nuevo.
 */
export function isFromOlderConnection(at: Date | null, connectedAt: Date | null): boolean {
  return Boolean(at && connectedAt && at.getTime() < connectedAt.getTime());
}

/**
 * Qué mostrar en la tarjeta «Historial del celular». Regla de fondo: no se
 * ofrece volver a pedir cuando ya se sabe que Meta lo va a rechazar; el botón
 * vuelve solo si el número se reconectó después.
 */
export function historyImportView(
  row: HistoryImportState | null,
  opts: { connectedAt: Date | null; now?: Date }
): HistoryImportView {
  const now = (opts.now ?? new Date()).getTime();
  const open: HistoryImportView = {
    kind: "idle",
    problem: null,
    canRequest: true,
    needsReconnect: false,
  };
  if (!row || row.status === "idle") return open;

  const older = (at: Date | null) => isFromOlderConnection(at, opts.connectedAt);
  const quietSince = (at: Date | null) => (at ? now - at.getTime() : 0);

  if (row.status === "requested") {
    if (older(row.requestedAt)) return open;
    return quietSince(row.requestedAt) >= HISTORY_STALLED_MS
      ? { kind: "stalled", problem: null, canRequest: false, needsReconnect: true }
      : { kind: "waiting", problem: null, canRequest: false, needsReconnect: false };
  }
  if (row.status === "receiving") {
    const last = row.lastChunkAt ?? row.requestedAt;
    return {
      kind: quietSince(last) >= HISTORY_STALLED_MS ? "paused" : "receiving",
      problem: null,
      canRequest: false,
      needsReconnect: false,
    };
  }

  const problem = older(row.attemptAt) ? null : problemOf(row);
  if (row.status === "done") {
    return { kind: "done", problem, canRequest: problem === null, needsReconnect: false };
  }
  if (row.status === "declined") {
    return { kind: "declined", problem: null, canRequest: true, needsReconnect: false };
  }
  return {
    kind: "failed",
    problem,
    canRequest: problem === null,
    needsReconnect: problem !== null,
  };
}
