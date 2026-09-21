/**
 * Lógica pura del grabador de notas de voz (015, US3): negociación del
 * formato de MediaRecorder, codificación WAV de respaldo y formato de tiempo.
 * Sin DOM: testeable en Node.
 */

/**
 * Preferencia de formato: Safari/iOS y Chrome de escritorio (126+) dan
 * `audio/mp4` (AAC = .m4a); Firefox `audio/ogg` (Opus). Chromium sin AAC
 * solo ofrece WebM, que el proveedor NO acepta → `null` = grabar WAV PCM.
 */
export const RECORDER_MIME_PREFERENCE = [
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

export function pickRecorderMimeType(isTypeSupported: (t: string) => boolean): string | null {
  for (const t of RECORDER_MIME_PREFERENCE) {
    try {
      if (isTypeSupported(t)) return t;
    } catch {
      // navegador raro: seguir probando
    }
  }
  return null;
}

/** "0:07", "2:59". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function fileNameFor(mime: string): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  const ext =
    base === "audio/mp4" || base === "audio/x-m4a"
      ? "m4a"
      : base === "audio/ogg"
        ? "ogg"
        : base === "audio/wav"
          ? "wav"
          : base === "audio/mpeg"
            ? "mp3"
            : "audio";
  return `nota-de-voz.${ext}`;
}

/**
 * Codifica muestras Float32 mono a WAV PCM16, con remuestreo lineal a
 * `targetRate` (16 kHz alcanza para voz y pesa 1/3 que 48 kHz).
 */
export function encodeWav(
  chunks: Float32Array[],
  inputRate: number,
  targetRate = 16000
): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  const ratio = inputRate / targetRate;
  const outLen = ratio > 1 ? Math.floor(merged.length / ratio) : merged.length;
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, merged.length - 1);
    const frac = pos - i0;
    const sample = (merged[i0] ?? 0) * (1 - frac) + (merged[i1] ?? 0) * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  const rate = ratio > 1 ? targetRate : inputRate;
  const dataBytes = pcm.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  new Int16Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}
