/**
 * Binarios del wa-mock (020): los bytes que el CRM descarga cuando un
 * cliente manda una foto o una nota de voz en el self-test.
 *
 * Son mínimos pero VÁLIDOS: el código de producción verifica la firma
 * binaria antes de mandarlos al proveedor, así que un archivo de relleno
 * haría pasar el test por el camino equivocado (`unsupported`).
 */

/** JPEG 1×1 real: empieza con FF D8 FF, como exige `sniffImageMime`. */
const JPEG_1X1_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof" +
  "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB" +
  "AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

export const MOCK_MEDIA_PREFIX = "mediamock_";

export type MockMedia = { bytes: Buffer; mimeType: string };

/** Página OggS mínima: `sniffAudioMime` la reconoce como audio/ogg. */
function oggBytes(): Buffer {
  return Buffer.concat([Buffer.from("OggS", "ascii"), Buffer.alloc(60)]);
}

/**
 * El tipo sale del propio id (`mediamock_<tipo>_<n>`), como haría un id
 * opaco de Meta contra su almacenamiento. Un id que contenga `empty`
 * devuelve un archivo que el ai-mock declara ilegible: es la única forma de
 * ejercitar el camino «no pude entenderlo» sin tocar el proveedor real
 * (FLAC para audio, PNG para imagen — los sentinels del ai-mock).
 */
export function mockMediaFor(mediaId: string): MockMedia {
  // 026: video y documento del cliente (se guardan para el equipo, sin IA).
  if (mediaId.startsWith(`${MOCK_MEDIA_PREFIX}video`)) {
    return { bytes: mp4Bytes(), mimeType: "video/mp4" };
  }
  if (mediaId.startsWith(`${MOCK_MEDIA_PREFIX}document`)) {
    return { bytes: pdfBytes(), mimeType: "application/pdf" };
  }
  const unreadable = mediaId.includes("empty");
  if (mediaId.startsWith(`${MOCK_MEDIA_PREFIX}audio`)) {
    return unreadable
      ? { bytes: flacBytes(), mimeType: "audio/flac" }
      : { bytes: oggBytes(), mimeType: "audio/ogg" };
  }
  return unreadable
    ? { bytes: pngBytes(), mimeType: "image/png" }
    : { bytes: Buffer.from(JPEG_1X1_BASE64, "base64"), mimeType: "image/jpeg" };
}

/** Cabecera fLaC: `sniffAudioMime` la reconoce y el ai-mock la declara vacía. */
function flacBytes(): Buffer {
  return Buffer.concat([Buffer.from("fLaC", "ascii"), Buffer.alloc(60)]);
}

/** PNG 1×1 mínimo (firma + IHDR): el ai-mock lo declara ilegible. */
function pngBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(60),
  ]);
}

export function isMockMediaId(id: string): boolean {
  return id.startsWith(MOCK_MEDIA_PREFIX);
}

/** 026: caja `ftyp` isom mínima: `classifyOutboundFile` la reconoce como MP4. */
function mp4Bytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from("ftypisom", "ascii"),
    Buffer.from([0x00, 0x00, 0x02, 0x00]),
    Buffer.from("isomiso2", "ascii"),
    Buffer.alloc(40),
  ]);
}

/** 026: PDF mínimo válido de una página vacía. */
function pdfBytes(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
      "trailer<</Root 1 0 R>>\n%%EOF\n",
    "latin1"
  );
}
