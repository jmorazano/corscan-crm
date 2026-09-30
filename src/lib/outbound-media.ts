import { ATTACHMENT_MARKER } from "@/lib/inbound-media";
import { sniffAudioMime } from "@/lib/voice-note";

/**
 * Reglas PURAS de los adjuntos que el equipo manda desde la Bandeja (026).
 *
 * Sin I/O: las comparten la ruta de subida (que manda, con los bytes), el
 * composer (rechazo temprano por extensión, antes de subir 25 MB para
 * nada) y el visor de binarios. Cuatro decisiones viven acá:
 *
 * 1. QUÉ ES el archivo (`classifyOutboundFile`): lo dice la firma binaria,
 *    nunca el MIME que declara el navegador. La extensión solo desempata lo
 *    que los bytes no distinguen (un .docx y un .zip empiezan igual).
 * 2. QUÉ ACEPTA cada canal (`CHANNEL_RULES`): la tabla de la documentación
 *    de Meta (30-sep-2026) más nuestro tope de 25 MB para documentos.
 * 3. CÓMO SE SIRVE (`servingPolicy`): inline solo lo que un navegador no
 *    puede ejecutar; lo demás se descarga.
 * 4. QUÉ VE EL AGENTE (`outboundAgentText`): que ya se mandó un archivo.
 */

export type OutboundChannel = "whatsapp" | "instagram";
export const OUTBOUND_KINDS = ["image", "video", "audio", "document"] as const;
export type OutboundKind = (typeof OUTBOUND_KINDS)[number];

const MB = 1024 * 1024;

/** El tope más grande de cualquier canal: corte temprano de la ruta. */
export const OUTBOUND_MAX_BYTES = 25 * MB;
/** WhatsApp acepta epígrafes de hasta 1.024 caracteres. */
export const OUTBOUND_CAPTION_MAX = 1024;
export const FILE_NAME_MAX = 120;

const PDF = "application/pdf";
const DOC = "application/msword";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLS = "application/vnd.ms-excel";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PPT = "application/vnd.ms-powerpoint";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const TXT = "text/plain";

export const OFFICE_MIMES = [DOC, DOCX, XLS, XLSX, PPT, PPTX] as const;

type Rule = { mimes: readonly string[]; maxBytes: number };

export const CHANNEL_RULES: Record<OutboundChannel, Record<OutboundKind, Rule>> = {
  whatsapp: {
    image: { mimes: ["image/jpeg", "image/png"], maxBytes: 5 * MB },
    video: { mimes: ["video/mp4", "video/3gpp"], maxBytes: 16 * MB },
    audio: {
      mimes: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"],
      maxBytes: 16 * MB,
    },
    document: { mimes: [PDF, ...OFFICE_MIMES, TXT], maxBytes: 25 * MB },
  },
  instagram: {
    image: { mimes: ["image/jpeg", "image/png"], maxBytes: 8 * MB },
    video: {
      mimes: ["video/mp4", "video/quicktime", "video/webm", "video/x-msvideo"],
      maxBytes: 25 * MB,
    },
    audio: { mimes: ["audio/aac", "audio/mp4", "audio/wav"], maxBytes: 25 * MB },
    document: { mimes: [PDF], maxBytes: 25 * MB },
  },
};

/** Con artículo, para que el mensaje concuerde («La imagen supera…»). */
const KIND_WITH_ARTICLE: Record<OutboundKind, string> = {
  image: "La imagen",
  video: "El video",
  audio: "El audio",
  document: "El documento",
};

const CHANNEL_NAME: Record<OutboundChannel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

export const KIND_LABEL: Record<OutboundKind, string> = {
  image: "imagen",
  video: "video",
  audio: "audio",
  document: "documento",
};

/** Lo que sí se puede mandar, para acompañar cada rechazo. */
export function allowedSummary(channel: OutboundChannel): string {
  return channel === "whatsapp"
    ? "imágenes JPG o PNG (hasta 5 MB), videos MP4 (16 MB), audios MP3, M4A, AAC u OGG (16 MB) y documentos PDF, Word, Excel, PowerPoint o TXT (25 MB)"
    : "imágenes JPG o PNG (hasta 8 MB), videos MP4, MOV o WebM (25 MB), audios M4A, AAC o WAV (25 MB) y documentos PDF (25 MB)";
}

/* ============================================================
 * Clasificación
 * ============================================================ */

export type ClassifiedFile = {
  kind: OutboundKind;
  /** MIME real (el que se le declara al canal y con el que se sirve). */
  mime: string;
  /** Nombre corto del formato para los mensajes («PDF», «WebP»…). */
  label: string;
  /** OGG: true si el códec es Opus (WhatsApp no acepta otro). */
  opus?: boolean;
};

export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function ascii(bytes: Uint8Array, offset: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + len));
}

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
}

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const EBML = [0x1a, 0x45, 0xdf, 0xa3];

const AUDIO_EXTENSIONS = new Set(["m4a", "m4b", "aac", "mp3", "ogg", "opus", "wav", "amr", "flac"]);

/** Contenedor ISO-BMFF (`ftyp`): la marca dice si es foto, audio o video. */
function classifyFtyp(bytes: Uint8Array, ext: string): ClassifiedFile {
  const brand = ascii(bytes, 8, 4);
  if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) {
    return { kind: "image", mime: "image/heic", label: "HEIC" };
  }
  if (brand === "avif" || brand === "avis") {
    return { kind: "image", mime: "image/avif", label: "AVIF" };
  }
  if (brand === "M4A " || brand === "M4B " || AUDIO_EXTENSIONS.has(ext)) {
    return { kind: "audio", mime: "audio/mp4", label: "M4A" };
  }
  if (brand === "qt  ") return { kind: "video", mime: "video/quicktime", label: "MOV" };
  if (brand.startsWith("3g")) return { kind: "video", mime: "video/3gpp", label: "3GP" };
  return { kind: "video", mime: "video/mp4", label: "MP4" };
}

function looksLikeText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8192);
  for (const b of head) if (b === 0) return false;
  return true;
}

/**
 * Qué es el archivo según sus bytes (y la extensión, solo para desempatar).
 * `null` = no es nada que algún canal acepte.
 */
export function classifyOutboundFile(bytes: Uint8Array, fileName: string): ClassifiedFile | null {
  if (bytes.length === 0) return null;
  const ext = extensionOf(fileName);

  // Imágenes.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: "image", mime: "image/jpeg", label: "JPG" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { kind: "image", mime: "image/png", label: "PNG" };
  if (ascii(bytes, 0, 4) === "GIF8") return { kind: "image", mime: "image/gif", label: "GIF" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { kind: "image", mime: "image/webp", label: "WebP" };
  }

  // Documentos.
  if (ascii(bytes, 0, 5) === "%PDF-") return { kind: "document", mime: PDF, label: "PDF" };
  if (startsWith(bytes, ZIP)) {
    if (ext === "docx") return { kind: "document", mime: DOCX, label: "Word" };
    if (ext === "xlsx") return { kind: "document", mime: XLSX, label: "Excel" };
    if (ext === "pptx") return { kind: "document", mime: PPTX, label: "PowerPoint" };
    return null; // un .zip (o un .docx renombrado a otra cosa)
  }
  if (startsWith(bytes, OLE2)) {
    if (ext === "doc") return { kind: "document", mime: DOC, label: "Word" };
    if (ext === "xls") return { kind: "document", mime: XLS, label: "Excel" };
    if (ext === "ppt") return { kind: "document", mime: PPT, label: "PowerPoint" };
    return null;
  }

  // Video y audio en contenedores.
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") return classifyFtyp(bytes, ext);
  if (startsWith(bytes, EBML)) {
    const head = ascii(bytes, 0, Math.min(bytes.length, 64));
    return head.includes("webm")
      ? { kind: "video", mime: "video/webm", label: "WebM" }
      : { kind: "video", mime: "video/x-matroska", label: "MKV" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "AVI ") {
    return { kind: "video", mime: "video/x-msvideo", label: "AVI" };
  }
  if (ascii(bytes, 0, 5) === "#!AMR") return { kind: "audio", mime: "audio/amr", label: "AMR" };
  if (ascii(bytes, 0, 4) === "OggS") {
    return {
      kind: "audio",
      mime: "audio/ogg",
      label: "OGG",
      opus: ascii(bytes, 28, 8) === "OpusHead",
    };
  }
  const audio = sniffAudioMime(bytes);
  if (audio) {
    const labels: Record<string, string> = {
      "audio/wav": "WAV",
      "audio/mp4": "M4A",
      "audio/mpeg": "MP3",
      "audio/aac": "AAC",
      "audio/flac": "FLAC",
      "audio/webm": "WebM",
    };
    // El sync de MPEG/ADTS (0xFF…) es una heurística débil: sin ID3 solo
    // vale si la extensión también dice audio (un binario cualquiera puede
    // empezar con 0xFF).
    const weak = (audio === "audio/mpeg" || audio === "audio/aac") && ascii(bytes, 0, 3) !== "ID3";
    if (!weak || AUDIO_EXTENSIONS.has(ext)) {
      return { kind: "audio", mime: audio, label: labels[audio] ?? "audio" };
    }
  }

  // Texto plano: solo con extensión de texto y sin bytes nulos.
  if ((ext === "txt" || ext === "csv") && looksLikeText(bytes)) {
    return { kind: "document", mime: TXT, label: ext.toUpperCase() };
  }
  return null;
}

/* ============================================================
 * Matriz por canal
 * ============================================================ */

export type OutboundCheck =
  | { ok: true }
  | { ok: false; status: 413 | 415 | 422; code: "too_large" | "unsupported" | "empty"; error: string };

function formatMb(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

/** ¿El canal acepta este archivo? Mensaje en castellano con la alternativa. */
export function checkChannelSupport(
  channel: OutboundChannel,
  file: ClassifiedFile & { size: number }
): OutboundCheck {
  const name = CHANNEL_NAME[channel];
  if (file.size <= 0) {
    return { ok: false, status: 422, code: "empty", error: "El archivo está vacío" };
  }
  const rule = CHANNEL_RULES[channel][file.kind];
  if (!rule.mimes.includes(file.mime)) {
    let error: string;
    if (channel === "instagram" && file.kind === "document") {
      error = "Instagram solo acepta documentos PDF.";
    } else if (file.kind === "image") {
      error = `${name} no acepta imágenes ${file.label}: mandala como JPG o PNG.`;
    } else if (file.mime === "video/quicktime" && channel === "whatsapp") {
      error =
        "WhatsApp solo acepta videos MP4 o 3GP: los .MOV (como los del iPhone) hay que convertirlos a MP4 antes de enviarlos.";
    } else {
      error = `${name} no acepta archivos ${file.label}. Podés mandar ${allowedSummary(channel)}.`;
    }
    return { ok: false, status: 415, code: "unsupported", error };
  }
  if (channel === "whatsapp" && file.mime === "audio/ogg" && file.opus === false) {
    return {
      ok: false,
      status: 415,
      code: "unsupported",
      error: "WhatsApp solo acepta audios OGG con códec Opus: mandalo como MP3 o M4A.",
    };
  }
  if (file.size > rule.maxBytes) {
    return {
      ok: false,
      status: 413,
      code: "too_large",
      error: `${KIND_WITH_ARTICLE[file.kind]} supera el máximo de ${formatMb(rule.maxBytes)} de ${name}.`,
    };
  }
  return { ok: true };
}

export type OutboundValidation =
  | {
      ok: true;
      kind: OutboundKind;
      mime: string;
      label: string;
      fileName: string;
    }
  | { ok: false; status: 413 | 415 | 422; code: "too_large" | "unsupported" | "empty"; error: string };

/** Validación completa del servidor: bytes → tipo → canal → nombre. */
export function validateOutboundFile(
  bytes: Uint8Array,
  fileName: string,
  channel: OutboundChannel
): OutboundValidation {
  if (bytes.length === 0) {
    return { ok: false, status: 422, code: "empty", error: "El archivo está vacío" };
  }
  const classified = classifyOutboundFile(bytes, fileName);
  if (!classified) {
    return {
      ok: false,
      status: 415,
      code: "unsupported",
      error: `${CHANNEL_NAME[channel]} no acepta ese tipo de archivo. Podés mandar ${allowedSummary(channel)}.`,
    };
  }
  const check = checkChannelSupport(channel, { ...classified, size: bytes.length });
  if (!check.ok) return check;
  return {
    ok: true,
    kind: classified.kind,
    mime: classified.mime,
    label: classified.label,
    fileName: sanitizeFileName(fileName, classified),
  };
}

/**
 * ¿El epígrafe viaja EN el adjunto? Instagram no acepta texto junto con un
 * adjunto y WhatsApp no le pone epígrafe a un audio: en esos casos el texto
 * sale después como un mensaje aparte.
 */
export function captionTravelsInline(channel: OutboundChannel, kind: OutboundKind): boolean {
  return channel === "whatsapp" && kind !== "audio";
}

/* ============================================================
 * Navegador: rechazo temprano por extensión
 * ============================================================ */

const BY_EXTENSION: Record<string, ClassifiedFile> = {
  jpg: { kind: "image", mime: "image/jpeg", label: "JPG" },
  jpeg: { kind: "image", mime: "image/jpeg", label: "JPG" },
  png: { kind: "image", mime: "image/png", label: "PNG" },
  webp: { kind: "image", mime: "image/webp", label: "WebP" },
  gif: { kind: "image", mime: "image/gif", label: "GIF" },
  heic: { kind: "image", mime: "image/heic", label: "HEIC" },
  heif: { kind: "image", mime: "image/heic", label: "HEIC" },
  mp4: { kind: "video", mime: "video/mp4", label: "MP4" },
  m4v: { kind: "video", mime: "video/mp4", label: "MP4" },
  "3gp": { kind: "video", mime: "video/3gpp", label: "3GP" },
  mov: { kind: "video", mime: "video/quicktime", label: "MOV" },
  webm: { kind: "video", mime: "video/webm", label: "WebM" },
  avi: { kind: "video", mime: "video/x-msvideo", label: "AVI" },
  mp3: { kind: "audio", mime: "audio/mpeg", label: "MP3" },
  m4a: { kind: "audio", mime: "audio/mp4", label: "M4A" },
  aac: { kind: "audio", mime: "audio/aac", label: "AAC" },
  ogg: { kind: "audio", mime: "audio/ogg", label: "OGG" },
  opus: { kind: "audio", mime: "audio/ogg", label: "OGG" },
  amr: { kind: "audio", mime: "audio/amr", label: "AMR" },
  wav: { kind: "audio", mime: "audio/wav", label: "WAV" },
  flac: { kind: "audio", mime: "audio/flac", label: "FLAC" },
  pdf: { kind: "document", mime: PDF, label: "PDF" },
  doc: { kind: "document", mime: DOC, label: "Word" },
  docx: { kind: "document", mime: DOCX, label: "Word" },
  xls: { kind: "document", mime: XLS, label: "Excel" },
  xlsx: { kind: "document", mime: XLSX, label: "Excel" },
  ppt: { kind: "document", mime: PPT, label: "PowerPoint" },
  pptx: { kind: "document", mime: PPTX, label: "PowerPoint" },
  txt: { kind: "document", mime: TXT, label: "TXT" },
  csv: { kind: "document", mime: TXT, label: "CSV" },
};

/** Lo que el navegador puede suponer sin leer los bytes. */
export function guessOutboundFile(name: string, type: string): ClassifiedFile | null {
  const byExt = BY_EXTENSION[extensionOf(name)];
  if (byExt) return byExt;
  // Una captura pegada puede no traer extensión: se usa el MIME declarado.
  const declared = type.split(";")[0]!.trim().toLowerCase();
  const byMime = Object.values(BY_EXTENSION).find((c) => c.mime === declared);
  return byMime ?? null;
}

/** Rechazo local antes de subir (el servidor revalida por firma). */
export function checkOutboundLocally(
  file: { name: string; type: string; size: number },
  channel: OutboundChannel
): { ok: true; kind: OutboundKind } | { ok: false; error: string } {
  if (file.size === 0) return { ok: false, error: "El archivo está vacío" };
  const guess = guessOutboundFile(file.name, file.type);
  if (!guess) {
    return {
      ok: false,
      error: `${CHANNEL_NAME[channel]} no acepta ese tipo de archivo. Podés mandar ${allowedSummary(channel)}.`,
    };
  }
  const check = checkChannelSupport(channel, { ...guess, size: file.size });
  if (!check.ok) return { ok: false, error: check.error };
  return { ok: true, kind: guess.kind };
}

/** `accept` del selector de archivos: solo lo que el canal manda. */
export function outboundAccept(channel: OutboundChannel): string {
  const exts = Object.entries(BY_EXTENSION)
    .filter(([, c]) => CHANNEL_RULES[channel][c.kind].mimes.includes(c.mime))
    .map(([ext]) => `.${ext}`);
  const mimes = OUTBOUND_KINDS.flatMap((k) => CHANNEL_RULES[channel][k].mimes);
  return [...new Set([...mimes, ...exts])].join(",");
}

/* ============================================================
 * Nombre de archivo y cómo se sirve
 * ============================================================ */

const DEFAULT_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "audio/wav": "wav",
  [PDF]: "pdf",
};

/**
 * Nombre visible y seguro: sin rutas, sin caracteres de control ni los que
 * rompen un encabezado HTTP, sin punto inicial, ≤120 caracteres conservando
 * la extensión. Sin nombre útil → «archivo.<ext>».
 */
export function sanitizeFileName(
  name: string | null | undefined,
  hint?: { mime: string } | null
): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  let clean = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (!clean) {
    const ext = hint ? DEFAULT_EXT[hint.mime] : undefined;
    return ext ? `archivo.${ext}` : "archivo";
  }
  if (clean.length > FILE_NAME_MAX) {
    const ext = extensionOf(clean);
    const suffix = ext && ext.length <= 8 ? `.${ext}` : "";
    clean = `${clean.slice(0, FILE_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
  }
  return clean;
}

const SAFE_INLINE = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/3gpp",
  "video/quicktime",
  "video/webm",
  PDF,
  TXT,
]);

/**
 * Cómo se sirve un binario guardado. Lo que manda un cliente es un dato
 * EXTERNO: un HTML o un SVG servido inline desde el dominio del CRM
 * ejecutaría su script con la sesión del operador. Inline solo lo que el
 * navegador muestra sin ejecutar; Office se descarga con su tipo; lo
 * desconocido viaja como binario opaco.
 */
export function servingPolicy(mime: string): { contentType: string; inline: boolean } {
  const m = mime.split(";")[0]!.trim().toLowerCase();
  if (m === TXT) return { contentType: "text/plain; charset=utf-8", inline: true };
  if (SAFE_INLINE.has(m) || (m.startsWith("audio/") && /^audio\/[a-z0-9.+-]+$/.test(m))) {
    return { contentType: m, inline: true };
  }
  if ((OFFICE_MIMES as readonly string[]).includes(m)) return { contentType: m, inline: false };
  return { contentType: "application/octet-stream", inline: false };
}

/** RFC 6266 + 5987: nombre ASCII de respaldo y el UTF-8 completo. */
export function contentDisposition(
  type: "inline" | "attachment",
  fileName: string | null | undefined
): string {
  if (!fileName) return type;
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** «1,2 MB», «340 KB» (para la tarjeta del documento y el adjunto pendiente). */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toFixed(1).replace(".", ",")} MB`;
}

/** «PDF», «Word»… para la tarjeta, a partir del MIME guardado. */
export function formatLabel(mime: string, fileName?: string | null): string {
  const byExt = fileName ? BY_EXTENSION[extensionOf(fileName)] : undefined;
  if (byExt) return byExt.label;
  const byMime = Object.values(BY_EXTENSION).find((c) => c.mime === mime);
  return byMime?.label ?? "Archivo";
}

/* ============================================================
 * Agente
 * ============================================================ */

const AGENT_LABEL: Record<OutboundKind, string> = {
  image: "una imagen",
  video: "un video",
  audio: "un audio",
  document: "un documento",
};

/**
 * Cómo entra al historial del agente un saliente. Sin esto un documento sin
 * epígrafe desaparecía del contexto (el pipeline descarta lo que no tiene
 * texto) y el agente podía ofrecer mandar algo que el equipo ya mandó.
 */
export function outboundAgentText(m: {
  type: string;
  text: string | null;
  status?: string | null;
}): string | null {
  const text = m.text?.trim() || null;
  if (!(OUTBOUND_KINDS as readonly string[]).includes(m.type)) return text;
  const label = AGENT_LABEL[m.type as OutboundKind];
  const marker =
    m.status === "failed"
      ? `${ATTACHMENT_MARKER} Intentaste mandarle al cliente ${label}, pero no se entregó.`
      : `${ATTACHMENT_MARKER} Le mandaste al cliente ${label}.`;
  return text ? `${marker}\n${text}` : marker;
}
