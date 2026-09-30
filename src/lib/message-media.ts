import type { MessageMediaDto } from "@/lib/types";

/**
 * El DTO del binario de un mensaje, armado en UN solo lugar (026): antes
 * cada sitio (Entrenador, entrantes, hilo) repetía la URL y los campos, y
 * sumar el nombre del documento hubiera sido tocar seis copias.
 */
export function toMediaDto(row: {
  id: string;
  mimeType: string;
  durationMs: number | null;
  fileName?: string | null;
  sizeBytes?: number | null;
}): MessageMediaDto {
  return {
    url: `/api/message-media/${row.id}`,
    mimeType: row.mimeType,
    durationMs: row.durationMs,
    fileName: row.fileName ?? null,
    sizeBytes: row.sizeBytes ?? null,
  };
}
