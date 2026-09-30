/**
 * Políticas PURAS de los adjuntos entrantes de WhatsApp (020).
 *
 * Sin I/O, sin base de datos, sin red: recibe datos y devuelve datos. Acá
 * viven las tres decisiones que el resto del código solo ejecuta:
 *
 * 1. QUÉ se descarga (`planInboundMedia`): audio e imagen se descargan Y
 *    se le dan a la IA; desde 026 video y documento se descargan SOLO para
 *    que el equipo los vea en el hilo (el agente no los lee).
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

/** Los que se descargan y se le dan a la IA (D10). 027: los PDF también. */
export type ProcessedMediaType = "audio" | "image" | "document";
/** 026: se descargan y se guardan para el equipo, sin IA. */
export type StoredMediaType = "video" | "document";

/**
 * 027: hasta acá se LEE un PDF (el cuerpo viaja en base64 al proveedor);
 * hasta `MEDIA_MAX_BYTES.document` se guarda igual para el equipo.
 */
export const PDF_READ_MAX_BYTES = 10 * 1024 * 1024;

/**
 * 027: ¿el documento es (o puede ser) un PDF? WhatsApp manda el MIME y el
 * nombre; Instagram no manda ninguno de los dos, pero solo permite adjuntar
 * PDFs como archivo. La firma binaria lo confirma después de bajarlo.
 */
export function looksLikePdf(hint?: { mime?: string | null; fileName?: string | null }): boolean {
  const mime = hint?.mime?.split(";")[0]?.trim().toLowerCase() || null;
  const name = hint?.fileName?.trim().toLowerCase() || null;
  if (!mime && !name) return true;
  return mime === "application/pdf" || (name?.endsWith(".pdf") ?? false);
}

export const MEDIA_MAX_BYTES: Record<"audio" | "image" | "video" | "document", number> = {
  /** Mismo tope que la nota de voz del entrenador (015). */
  audio: 8 * 1024 * 1024,
  /** Mismo tope que el encabezado de plantilla (008). */
  image: 5 * 1024 * 1024,
  /** 026: el máximo que WhatsApp deja mandar. */
  video: 16 * 1024 * 1024,
  /** 026: el mismo tope que el equipo tiene para enviar (decisión del dueño). */
  document: 25 * 1024 * 1024,
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
  /**
   * 026: se descarga y se guarda para verlo en el hilo; NO retiene el turno
   * del agente (su marcador no depende del binario).
   */
  | { kind: "store"; type: StoredMediaType; maxBytes: number }
  /** No se descarga, pero el agente se entera de que llegó. */
  | { kind: "acknowledge"; type: MediaType }
  /** Mensaje sin adjunto (texto, ubicación, contacto…). */
  | { kind: "none" };

/**
 * Qué hacer con un mensaje entrante. Sin `mediaId` no hay nada que bajar,
 * aunque el tipo lo permita: el webhook llegó incompleto y el agente igual
 * tiene que enterarse de que el cliente mandó algo.
 */
export function planInboundMedia(
  type: string,
  mediaId: string | null | undefined,
  /** 027: MIME y nombre del webhook, para saber si un documento es PDF. */
  hint?: { mime?: string | null; fileName?: string | null }
): MediaPlan {
  if (!MEDIA_TYPES.includes(type as MediaType)) return { kind: "none" };
  const media = type as MediaType;
  if ((media === "audio" || media === "image") && mediaId) {
    return { kind: "process", type: media, maxBytes: MEDIA_MAX_BYTES[media] };
  }
  // 027: el PDF se LEE (y retiene el turno, como una imagen); el resto de
  // los documentos solo se guarda para el equipo.
  if (media === "document" && mediaId && looksLikePdf(hint)) {
    return { kind: "process", type: "document", maxBytes: MEDIA_MAX_BYTES.document };
  }
  if ((media === "video" || media === "document") && mediaId) {
    return { kind: "store", type: media, maxBytes: MEDIA_MAX_BYTES[media] };
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
  /** 027 */
  document: "No se pudo leer el documento",
  document_too_long: "El PDF es demasiado grande para leerlo (más de 10 MB)",
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
  /** Descripción generada por IA (imágenes; 027: resumen de un PDF). */
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

  // 027: un PDF leído entra con su resumen (escrito por la IA, es DATO).
  if (type === "document") {
    if (m.mediaState === "ready" && m.mediaSummary?.trim()) {
      return `${ATTACHMENT_MARKER} El cliente mandó un documento PDF: ${m.mediaSummary.trim()}`;
    }
    if (m.mediaState === "pending") {
      return `${ATTACHMENT_MARKER} El cliente mandó un documento que todavía se está leyendo.`;
    }
    if (m.mediaState === "failed") {
      return `${ATTACHMENT_MARKER} El cliente mandó un documento que no se pudo leer. Preguntale de qué se trata o escalá si hace falta.`;
    }
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
