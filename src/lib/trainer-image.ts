import { sniffImageMime, type InboundImageMime } from "@/lib/inbound-media";

/**
 * Imágenes que el dueño le manda a su agente en el Entrenador (022):
 * reglas PURAS compartidas por el endpoint de subida, el composer y el
 * turno del entrenador.
 *
 * Diferencia con las imágenes de clientes (020): acá la imagen es MATERIAL
 * DE ESTUDIO (una lista de precios, la foto de un producto, una captura de
 * la web) y se lee completa, importes incluidos. Lo que se lee sigue siendo
 * DATO para el modelo: entra con marcador, nunca como instrucción.
 */

/** Mismo tope que la imagen de plantilla (008) y la de clientes (020). */
export const TRAINER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Epígrafe opcional (el texto del composer al adjuntar). */
export const TRAINER_IMAGE_CAPTION_MAX = 1000;

export const TRAINER_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type TrainerImageMime = InboundImageMime;

export const TRAINER_IMAGE_ERRORS = {
  empty: "La imagen no tiene contenido reconocible",
  unsupported:
    "El modelo de visión configurado no acepta imágenes. Cambialo en Ajustes → Inteligencia artificial",
  provider: "No se pudo leer la imagen",
  not_configured: "La empresa no tiene IA configurada",
} as const;

/** Marcador con el que la lectura entra al turno: DATO, no instrucción. */
export const TRAINER_IMAGE_MARKER = "[IMAGEN]";

export type TrainerImageValidation =
  | { ok: true; mime: TrainerImageMime }
  | { ok: false; status: 413 | 415 | 422; code: string; error: string };

/** El MIME declarado es informativo: manda la firma binaria. */
export function validateTrainerImage(
  bytes: Uint8Array,
  _declaredMime: string
): TrainerImageValidation {
  if (bytes.byteLength === 0) {
    return { ok: false, status: 422, code: "invalid", error: "La imagen está vacía" };
  }
  if (bytes.byteLength > TRAINER_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      code: "too_large",
      error: "La imagen supera el máximo de 5 MB",
    };
  }
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) {
    return {
      ok: false,
      status: 415,
      code: "unsupported_media",
      error: "El archivo no es una imagen JPEG, PNG o WebP válida",
    };
  }
  return { ok: true, mime: sniffed };
}

/** ¿Este archivo del composer parece una imagen aceptada? (chequeo local previo). */
export function looksLikeTrainerImage(file: { type: string; name: string }): boolean {
  if (file.type) return (TRAINER_IMAGE_MIMES as readonly string[]).includes(file.type.toLowerCase());
  return /\.(jpe?g|png|webp)$/i.test(file.name);
}

export type TrainerImageView = {
  mediaState: "pending" | "ready" | "failed" | null;
  /** Lo que leyó la visión (`media_summary`). */
  mediaSummary: string | null;
  /** Epígrafe del dueño. */
  text: string | null;
  error: string | null;
};

/**
 * Cómo entra la imagen al historial del turno del Entrenador, o `null` si
 * todavía se está leyendo (el turno forzado la incluirá cuando termine).
 * Una lectura fallida TAMBIÉN produce una línea: el agente tiene que
 * enterarse de que hubo una imagen y pedir el contenido por texto, no
 * callar.
 */
export function trainerImageContext(m: TrainerImageView): string | null {
  const caption = m.text?.trim() || null;
  if (m.mediaState === "pending") return null;
  if (m.mediaState === "ready" && m.mediaSummary?.trim()) {
    const head = `${TRAINER_IMAGE_MARKER} Tu dueño/a te mandó una imagen. Lo que se ve y se lee en ella:\n${m.mediaSummary.trim()}`;
    return caption ? `${head}\n\nEpígrafe: ${caption}` : head;
  }
  const head = `${TRAINER_IMAGE_MARKER} Tu dueño/a te mandó una imagen que no se pudo leer${m.error ? ` (${m.error})` : ""}. Pedile amablemente que te lo cuente por texto.`;
  return caption ? `${head}\nEpígrafe: ${caption}` : head;
}
