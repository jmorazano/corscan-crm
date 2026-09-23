import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Autenticación en dos capas del webhook (contrato webhook.md / DV-VC-02).
 * Este módulo es puro (sin BD) para poder testearse unitariamente.
 */

/** Comparación timing-safe de strings de longitud arbitraria. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Capa 1: el segmento de la ruta debe coincidir con el verify token. */
export function isValidWebhookToken(
  segment: string,
  verifyToken: string
): boolean {
  return verifyToken.length > 0 && safeEqual(segment, verifyToken);
}

/**
 * Capa 2 (opcional): firma HMAC-SHA256 de Meta sobre el body CRUDO.
 * Devuelve true si no hay secreto configurado (capa desactivada).
 */
export function isValidSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined
): boolean {
  if (!appSecret) return true;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  return safeEqual(signatureHeader.slice("sha256=".length), expected);
}

/* ---------- Tipos del payload de Meta (subconjunto soportado) ---------- */

export type WebhookMessage = {
  from: string;
  /** Solo en ecos e historial de salientes (017). */
  to?: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: WebhookMedia;
  video?: WebhookMedia;
  audio?: WebhookMedia;
  document?: WebhookMedia;
  sticker?: WebhookMedia;
  /** Historial del celular (017): estado de entrega del mensaje original. */
  history_context?: { status?: string; from_me?: boolean };
};

export type WebhookMedia = {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
};

/** 017: un chunk del webhook `history` (o el error de rechazo). */
export type WebhookHistoryChunk = {
  metadata?: { phase?: number; chunk_order?: number; progress?: number };
  threads?: { id: string; messages?: WebhookMessage[] }[];
  errors?: { code?: number; title?: string; message?: string }[];
};

/** 017: contacto de la agenda del celular (`smb_app_state_sync`). */
export type WebhookStateSync = {
  type?: string;
  contact?: { full_name?: string; first_name?: string; phone_number?: string };
  action?: string;
  metadata?: { timestamp?: string };
};

export type WebhookStatus = {
  id: string;
  status: string;
  timestamp: string;
  recipient_id?: string;
  errors?: { code: number; title?: string; message?: string }[];
};

export type WebhookValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: WebhookMessage[];
  statuses?: WebhookStatus[];
  // 017 coexistence
  history?: WebhookHistoryChunk[];
  message_echoes?: WebhookMessage[];
  state_sync?: WebhookStateSync[];
  // message_template_status_update
  event?: string;
  message_template_name?: string;
  message_template_language?: string;
  message_template_id?: number | string;
  reason?: string | null;
};

export type WebhookChange = { field?: string; value?: WebhookValue };

export type WebhookPayload = {
  object?: string;
  entry?: { id?: string; changes?: WebhookChange[] }[];
};
