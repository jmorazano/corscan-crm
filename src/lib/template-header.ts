/**
 * Validación pura de la imagen de encabezado de plantillas (008, FR-001/002).
 * Compartida por el endpoint de alta (autoridad) y testeable sin BD. El MIME
 * declarado no alcanza: se verifica la firma binaria (magic bytes) para que
 * un .txt renombrado .jpg no llegue a Meta.
 */

export const HEADER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const HEADER_IMAGE_MIMES = ["image/jpeg", "image/png"] as const;
export type HeaderImageMime = (typeof HEADER_IMAGE_MIMES)[number];

export type HeaderImageValidation =
  | { ok: true; mime: HeaderImageMime }
  | { ok: false; error: string };

function sniffMime(bytes: Buffer): HeaderImageMime | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

export function validateHeaderImage(
  bytes: Buffer,
  declaredMime: string
): HeaderImageValidation {
  if (bytes.byteLength === 0) {
    return { ok: false, error: "La imagen está vacía" };
  }
  if (bytes.byteLength > HEADER_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      error: "La imagen supera el máximo de 5MB que acepta WhatsApp",
    };
  }
  const sniffed = sniffMime(bytes);
  if (!sniffed) {
    return {
      ok: false,
      error: "El archivo no es una imagen JPEG o PNG válida",
    };
  }
  const declared = declaredMime.trim().toLowerCase();
  // "image/jpg" es un alias frecuente del navegador; el contenido manda.
  if (
    declared &&
    declared !== sniffed &&
    !(declared === "image/jpg" && sniffed === "image/jpeg")
  ) {
    return {
      ok: false,
      error: "El tipo del archivo no coincide con su contenido (JPEG/PNG)",
    };
  }
  return { ok: true, mime: sniffed };
}
