import type { AudioFormat } from "@/lib/ai";

/**
 * Validación pura de notas de voz (015, US3), compartida por el endpoint de
 * subida y el composer. El MIME declarado no alcanza: se verifica la firma
 * binaria, y WebM/Matroska se rechaza porque el proveedor no lo acepta.
 */

export const VOICE_NOTE_MAX_BYTES = 8 * 1024 * 1024; // WAV 16 kHz mono 3 min ≈ 5.8 MB
export const VOICE_NOTE_MAX_MS = 180_000;

export type VoiceMime =
  | "audio/wav"
  | "audio/mp4"
  | "audio/ogg"
  | "audio/mpeg"
  | "audio/aac"
  | "audio/flac";

const FORMAT_BY_MIME: Record<VoiceMime, AudioFormat> = {
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

/** Minúsculas, sin `;codecs=`, alias frecuentes normalizados. */
export function normalizeMime(declared: string): string {
  const base = declared.split(";")[0]!.trim().toLowerCase();
  const alias: Record<string, string> = {
    "audio/x-m4a": "audio/mp4",
    "audio/m4a": "audio/mp4",
    "audio/aac": "audio/aac",
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/vnd.wave": "audio/wav",
    "audio/mp3": "audio/mpeg",
    "audio/x-flac": "audio/flac",
    "video/mp4": "audio/mp4",
    "video/webm": "audio/webm",
  };
  return alias[base] ?? base;
}

function ascii(bytes: Uint8Array, offset: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + len));
}

/** Firma binaria → MIME. `audio/webm` se reconoce solo para rechazarlo. */
export function sniffAudioMime(bytes: Uint8Array): VoiceMime | "audio/webm" | null {
  if (bytes.length < 12) return null;
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return "audio/wav";
  if (ascii(bytes, 4, 4) === "ftyp") return "audio/mp4";
  if (ascii(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(bytes, 0, 4) === "fLaC") return "audio/flac";
  if (ascii(bytes, 0, 3) === "ID3") return "audio/mpeg";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "audio/webm";
  }
  if (bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0) return "audio/aac"; // ADTS
  if (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "audio/mpeg"; // MPEG sync
  return null;
}

export function audioFormatForMime(mime: VoiceMime): AudioFormat {
  return FORMAT_BY_MIME[mime];
}

export type VoiceNoteValidation =
  | { ok: true; mime: VoiceMime; format: AudioFormat }
  | { ok: false; status: 413 | 415 | 422; code: string; error: string };

export function validateVoiceNote(bytes: Uint8Array, declaredMime: string): VoiceNoteValidation {
  if (bytes.byteLength === 0) {
    return { ok: false, status: 422, code: "invalid", error: "El audio está vacío" };
  }
  if (bytes.byteLength > VOICE_NOTE_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      code: "too_large",
      error: "La nota de voz supera el máximo de 8 MB (unos 3 minutos)",
    };
  }
  const sniffed = sniffAudioMime(bytes);
  if (sniffed === "audio/webm") {
    return {
      ok: false,
      status: 415,
      code: "unsupported_media",
      error:
        "El formato WebM no es aceptado por el proveedor de IA; grabá desde la app o subí un .m4a, .ogg, .wav o .mp3",
    };
  }
  if (!sniffed) {
    // Sin firma reconocible: si el navegador lo declaró como audio aceptado,
    // igual lo rechazamos — el proveedor fallaría con un error opaco.
    return {
      ok: false,
      status: 415,
      code: "unsupported_media",
      error: "El archivo no es un audio válido (.m4a, .ogg, .wav, .mp3, .aac o .flac)",
    };
  }
  void normalizeMime(declaredMime); // el contenido manda; lo declarado es informativo
  return { ok: true, mime: sniffed, format: audioFormatForMime(sniffed) };
}
