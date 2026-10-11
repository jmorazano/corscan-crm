import { z } from "zod";
import type { ConversationOrigin } from "@/lib/conversation-origin";
import { sanitizeForeignText } from "@/server/mcp/sanitize";

/**
 * Origen de anuncios Click-to-WhatsApp (035) — PURO.
 *
 * El primer mensaje que llega tocando un anuncio (o una publicación
 * promocionada) con el botón «Enviar mensaje de WhatsApp» trae, además del
 * contenido, un objeto `referral` (Cloud API, `messages[].referral`). Con eso
 * la conversación queda marcada con el anuncio (`conversation.ig_origin` +
 * etiqueta `wa-anuncio`) y el agente sabe desde dónde llegó la persona.
 *
 * TODO lo que trae es texto de un tercero:
 * - se valida con Zod campo por campo: un campo de tipo raro se descarta sin
 *   tumbar el resto, y un referral ilegible se ignora sin tumbar el mensaje;
 * - el texto pasa por el MISMO saneo del texto ajeno de 016 (invisibles,
 *   bidi, marcadores del sistema, cercos) y queda en una línea, sin comillas
 *   angulares (el prompt lo cita entre «») y recortado;
 * - los identificadores solo aceptan ASCII visible y el enlace solo https.
 */

/** Etiqueta de conversación que deja un anuncio (par de `ig-anuncio`, 030). */
export const WA_AD_TAG = "wa-anuncio";

/** Título del anuncio dentro de la etiqueta visible («Anuncio: …»). */
export const AD_LABEL_HEADLINE_MAX = 80;
export const AD_HEADLINE_MAX = 200;
export const AD_BODY_MAX = 500;
export const AD_WELCOME_MAX = 300;
const SOURCE_ID_MAX = 64;
/** El `ctwa_clid` real ronda los 100–200 caracteres; uno más largo no se recorta (no serviría), se descarta. */
const CLICK_ID_MAX = 1024;
const URL_MAX = 2048;

export const AD_FALLBACK_LABEL = "Anuncio de Facebook/Instagram";

/** Texto opcional: cualquier otro tipo (número, objeto…) cuenta como ausente. */
const looseText = z.string().nullish().catch(null);
/** Identificador: Meta lo manda como string, pero un número también sirve. */
const looseId = z.union([z.string(), z.number()]).nullish().catch(null);

const referralSchema = z
  .object({
    source_url: looseText,
    source_id: looseId,
    source_type: looseText,
    headline: looseText,
    body: looseText,
    media_type: looseText,
    // image_url / video_url / thumbnail_url: URLs de la CDN de Meta que
    // vencen. No se guardan (ver spec): pasan por `passthrough` y se ignoran.
    ctwa_clid: looseText,
    welcome_message: z.object({ text: looseText }).passthrough().nullish().catch(null),
  })
  .passthrough();

/** El `referral` ya validado y saneado. */
export type WhatsAppReferral = {
  sourceId: string | null;
  sourceType: "ad" | "post" | null;
  sourceUrl: string | null;
  headline: string | null;
  body: string | null;
  mediaType: "image" | "video" | null;
  clickId: string | null;
  welcome: string | null;
};

/**
 * Texto ajeno → una línea lista para guardar o citar como DATO: saneada
 * (016), sin saltos de línea ni comillas angulares (no puede cerrar la cita
 * «…» del prompt), recortada. `null` si no queda nada.
 */
export function adText(raw: unknown, max: number): string | null {
  const clean = sanitizeForeignText(raw, max)
    .replace(/\s+/g, " ")
    .replace(/[«»]/g, '"')
    .trim();
  return clean || null;
}

/** Identificador opaco: ASCII visible, sin espacios ni controles, con tope. */
function cleanId(raw: string | number | null | undefined, max: number): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  if (!value || value.length > max) return null;
  return /^[\x21-\x7E]+$/.test(value) ? value : null;
}

/** Solo un enlace https absoluto, sin usuario/contraseña y de largo razonable. */
function httpsUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || value.length > URL_MAX) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Valida y normaliza el `referral` crudo del webhook. `null` si no es un
 * objeto o si no trae nada que identifique al anuncio (un `{}` no es un
 * anuncio). Nunca lanza.
 */
export function parseWhatsAppReferral(raw: unknown): WhatsAppReferral | null {
  try {
    return normalizeReferral(raw);
  } catch {
    // Cinturón: el webhook procesa el resto del lote pase lo que pase.
    return null;
  }
}

function normalizeReferral(raw: unknown): WhatsAppReferral | null {
  const parsed = referralSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  const type = r.source_type?.trim().toLowerCase();
  const media = r.media_type?.trim().toLowerCase();
  const referral: WhatsAppReferral = {
    sourceId: cleanId(r.source_id, SOURCE_ID_MAX),
    sourceType: type === "ad" || type === "post" ? type : null,
    sourceUrl: httpsUrl(r.source_url),
    headline: adText(r.headline, AD_HEADLINE_MAX),
    body: adText(r.body, AD_BODY_MAX),
    mediaType: media === "image" || media === "video" ? media : null,
    clickId: cleanId(r.ctwa_clid, CLICK_ID_MAX),
    welcome: adText(r.welcome_message?.text, AD_WELCOME_MAX),
  };
  const identifies =
    referral.sourceId ||
    referral.clickId ||
    referral.sourceUrl ||
    referral.headline ||
    referral.body ||
    referral.sourceType;
  return identifies ? referral : null;
}

/** Corta por caracteres reales (no parte un emoji) y marca el corte con «…». */
function truncateChars(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** El origen que queda en la conversación (lo que ve el equipo y el agente). */
export function whatsAppAdOrigin(referral: WhatsAppReferral, at: Date): ConversationOrigin {
  const when = Number.isNaN(at.getTime()) ? new Date() : at;
  return {
    kind: "ad",
    channel: "whatsapp",
    label: referral.headline
      ? `Anuncio: ${truncateChars(referral.headline, AD_LABEL_HEADLINE_MAX)}`
      : AD_FALLBACK_LABEL,
    ref: referral.sourceId,
    detail: referral.headline,
    sourceType: referral.sourceType,
    sourceUrl: referral.sourceUrl,
    clickId: referral.clickId,
    body: referral.body,
    mediaType: referral.mediaType,
    welcome: referral.welcome,
    at: when.toISOString(),
  };
}

/**
 * Qué hacer con un origen nuevo (última atribución):
 * - `apply`: no había origen, o este clic es igual o más nuevo → reemplaza;
 * - `duplicate`: es el MISMO clic (Meta reentregó el mensaje) → nada;
 * - `stale`: llegó tarde un clic más viejo que el guardado → nada.
 */
export type AdOriginDecision = "apply" | "duplicate" | "stale";

export function decideAdOrigin(
  current: ConversationOrigin | null,
  next: ConversationOrigin
): AdOriginDecision {
  if (!current) return "apply";
  const sameClick =
    current.kind === next.kind &&
    (current.channel ?? "instagram") === (next.channel ?? "instagram") &&
    (current.ref ?? null) === (next.ref ?? null) &&
    (current.clickId ?? null) === (next.clickId ?? null) &&
    current.at === next.at;
  if (sameClick) return "duplicate";
  const prev = Date.parse(current.at);
  const now = Date.parse(next.at);
  if (Number.isFinite(prev) && Number.isFinite(now) && now < prev) return "stale";
  return "apply";
}
