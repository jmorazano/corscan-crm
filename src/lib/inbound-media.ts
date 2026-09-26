/**
 * Políticas PURAS de los adjuntos entrantes de WhatsApp (020).
 *
 * Sin I/O, sin base de datos, sin red: recibe datos y devuelve datos. Acá
 * viven las tres decisiones que el resto del código solo ejecuta:
 *
 * 1. QUÉ se descarga (`planInboundMedia`): solo audio e imagen. Un video de
 *    16 MB no aporta nada al agente y sí llena Postgres.
 * 2. CUÁNTO se acepta (`MEDIA_MAX_BYTES`): el tope se aplica dos veces —
 *    con el `file_size` que declara Meta, antes de bajar el cuerpo, y otra
 *    vez sobre los bytes reales.
 * 3. QUÉ VE EL AGENTE (`attachmentMarker`): un mensaje sin texto lo filtra
 *    el pipeline y el agente queda mudo. Todo adjunto —incluso uno que
 *    falló— produce una línea que el modelo puede leer.
 */

/**
 * Tipos de mensaje entrante que traen un binario adjunto en el webhook.
 * 023: `share` (publicación o reel compartido), `story` (mención o respuesta
 * a una historia) y `unsupported` son de Instagram: no se bajan, pero el
 * agente se entera de que llegaron (nunca queda mudo).
 */
export const MEDIA_TYPES = [
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "share",
  "story",
  "unsupported",
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Los únicos que se descargan y se le dan a la IA (D10). */
export type ProcessedMediaType = "audio" | "image";

export const MEDIA_MAX_BYTES: Record<ProcessedMediaType, number> = {
  /** Mismo tope que la nota de voz del entrenador (015). */
  audio: 8 * 1024 * 1024,
  /** Mismo tope que el encabezado de plantilla (008). */
  image: 5 * 1024 * 1024,
};

/**
 * Prefijo del texto que describe un adjunto. Mismo contrato que
 * `[HERRAMIENTA]` en 016: es DATO sobre lo que hizo el cliente, nunca una
 * instrucción que el modelo deba obedecer.
 */
export const ATTACHMENT_MARKER = "[ADJUNTO]";

export type MediaPlan =
  /** Se descarga y se manda a la IA. */
  | { kind: "process"; type: ProcessedMediaType; maxBytes: number }
  /** No se descarga, pero el agente se entera de que llegó. */
  | { kind: "acknowledge"; type: MediaType }
  /** Mensaje sin adjunto (texto, ubicación, contacto…). */
  | { kind: "none" };

/**
 * Qué hacer con un mensaje entrante. Sin `mediaId` no hay nada que bajar,
 * aunque el tipo lo permita: el webhook llegó incompleto y el agente igual
 * tiene que enterarse de que el cliente mandó algo.
 */
export function planInboundMedia(type: string, mediaId: string | null | undefined): MediaPlan {
  if (!MEDIA_TYPES.includes(type as MediaType)) return { kind: "none" };
  const media = type as MediaType;
  if ((media === "audio" || media === "image") && mediaId) {
    return { kind: "process", type: media, maxBytes: MEDIA_MAX_BYTES[media] };
  }
  return { kind: "acknowledge", type: media };
}

/** Estado del procesamiento del adjunto (columna `message.media_state`). */
export type MediaState = "pending" | "ready" | "failed";

export const MEDIA_ERRORS = {
  too_large: "El archivo es más grande de lo que aceptamos",
  download: "No se pudo descargar el archivo",
  unsupported: "El formato del archivo no es compatible",
  transcription: "No se pudo transcribir el audio",
  vision: "No se pudo interpretar la imagen",
  not_configured: "La empresa no tiene IA configurada",
} as const;
export type MediaErrorCode = keyof typeof MEDIA_ERRORS;

/** Cómo se nombra cada tipo dentro del marcador. */
const TYPE_LABEL: Record<MediaType, string> = {
  image: "una imagen",
  audio: "una nota de voz",
  video: "un video",
  document: "un documento",
  sticker: "un sticker",
  share: "una publicación de Instagram compartida",
  story: "una mención o respuesta a una historia de Instagram",
  unsupported: "un adjunto que Instagram no deja abrir",
};

export type AttachmentView = {
  type: string;
  mediaState: MediaState | null;
  /** Epígrafe real del cliente, o la transcripción de un audio. */
  text: string | null;
  /** Descripción generada por IA (solo imágenes). */
  mediaSummary: string | null;
};

/**
 * La línea que describe el adjunto para el agente, o `null` cuando el
 * mensaje no necesita ninguna (es texto, o el `text` ya trae la
 * transcripción del audio).
 *
 * Un audio LISTO no lleva marcador a propósito: su transcripción es
 * literalmente lo que la persona dijo y entra al historial como su mensaje.
 */
export function attachmentMarker(m: AttachmentView): string | null {
  if (!MEDIA_TYPES.includes(m.type as MediaType)) return null;
  const type = m.type as MediaType;

  if (type === "audio") {
    if (m.mediaState === "ready" && m.text?.trim()) return null;
    if (m.mediaState === "pending") {
      return `${ATTACHMENT_MARKER} El cliente mandó una nota de voz que todavía se está transcribiendo.`;
    }
    return `${ATTACHMENT_MARKER} El cliente mandó una nota de voz que no se pudo transcribir. Pedile amablemente que te lo escriba.`;
  }

  if (type === "image") {
    if (m.mediaState === "ready" && m.mediaSummary?.trim()) {
      return `${ATTACHMENT_MARKER} El cliente mandó una imagen: ${m.mediaSummary.trim()}`;
    }
    if (m.mediaState === "pending") {
      return `${ATTACHMENT_MARKER} El cliente mandó una imagen que todavía se está procesando.`;
    }
    return `${ATTACHMENT_MARKER} El cliente mandó una imagen que no se pudo ver. Preguntale de qué se trata.`;
  }

  return `${ATTACHMENT_MARKER} El cliente mandó ${TYPE_LABEL[type]}. No lo podés abrir: preguntale de qué se trata o escalá si hace falta.`;
}

/**
 * El texto con el que un mensaje entra al historial del agente: el marcador
 * del adjunto y, si además hay texto real del cliente (un epígrafe, o la
 * transcripción), los dos. Devuelve `null` cuando no hay nada que decir.
 */
export function agentTextFor(m: AttachmentView): string | null {
  const marker = attachmentMarker(m);
  const text = m.text?.trim() || null;
  if (marker && text) return `${marker}\n${text}`;
  return marker ?? text;
}

/* ============================================================
 * Firmas binarias de imagen
 * ============================================================ */

export const INBOUND_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type InboundImageMime = (typeof INBOUND_IMAGE_MIMES)[number];

/**
 * El `mime_type` declarado por Meta no alcanza: lo que se le manda al
 * proveedor tiene que coincidir con el contenido real, o el modelo devuelve
 * un error opaco.
 */
export function sniffImageMime(bytes: Uint8Array): InboundImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
