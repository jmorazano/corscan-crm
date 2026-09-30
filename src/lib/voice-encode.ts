import { DEFAULT_PRE_SKIP, muxOggOpus, OPUS_GRANULE_RATE } from "@/lib/ogg-opus";

/**
 * Nota de voz para WhatsApp (027): PCM del micrófono → Opus con WebCodecs
 * (`AudioEncoder`: Chrome/Edge, Firefox 130+, Safari 26+) → OGG propio.
 * Solo navegador. 16 kb/s mono en modo voz: 3 minutos ≈ 360 KB, debajo de
 * los 512 KB con los que WhatsApp muestra el ▶ en vez de «descargar».
 */

const BASE_CONFIG: AudioEncoderConfig = {
  codec: "opus",
  sampleRate: OPUS_GRANULE_RATE,
  numberOfChannels: 1,
  bitrate: 16_000,
};

/** Con la sintonía de voz si el navegador la acepta; si no, la base. */
const VOICE_CONFIG = {
  ...BASE_CONFIG,
  opus: { application: "voip", frameDuration: 20_000 },
} as AudioEncoderConfig;

async function supportedConfig(): Promise<AudioEncoderConfig | null> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return null;
  for (const config of [VOICE_CONFIG, BASE_CONFIG]) {
    try {
      const r = await AudioEncoder.isConfigSupported(config);
      if (r.supported) return config;
    } catch {
      // configuración que este navegador no entiende: probar la siguiente
    }
  }
  return null;
}

/** ¿Este navegador puede grabar una nota de voz que WhatsApp muestre como tal? */
export async function canEncodeOpus(): Promise<boolean> {
  return (await supportedConfig()) !== null;
}

/** Remuestreo lineal (alcanza para voz) a 48 kHz, la tasa nativa de Opus. */
export function resampleTo48k(chunks: Float32Array[], inputRate: number): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  if (inputRate === OPUS_GRANULE_RATE) return merged;
  const ratio = inputRate / OPUS_GRANULE_RATE;
  const outLen = Math.floor(merged.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, merged.length - 1);
    const frac = pos - i0;
    out[i] = (merged[i0] ?? 0) * (1 - frac) + (merged[i1] ?? 0) * frac;
  }
  return out;
}

/** Pre-skip real si el codificador entrega el OpusHead; si no, el de libopus. */
function preSkipFrom(description: ArrayBuffer | ArrayBufferView | undefined): number {
  if (!description) return DEFAULT_PRE_SKIP;
  const bytes =
    description instanceof ArrayBuffer
      ? new Uint8Array(description)
      : new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 8)) === "OpusHead") {
    return bytes[10]! | (bytes[11]! << 8);
  }
  return DEFAULT_PRE_SKIP;
}

/** Codifica lo grabado a un `.ogg` Opus mono. Lanza si el navegador no puede. */
export async function encodeOggOpus(
  chunks: Float32Array[],
  inputRate: number
): Promise<Uint8Array> {
  const config = await supportedConfig();
  if (!config) throw new Error("Este navegador no codifica Opus");
  const pcm = resampleTo48k(chunks, inputRate);

  const packets: Uint8Array[] = [];
  let description: ArrayBuffer | ArrayBufferView | undefined;
  let failure: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      packets.push(bytes);
      const d = meta?.decoderConfig?.description;
      if (d && !description) description = d as ArrayBuffer | ArrayBufferView;
    },
    error: (e) => {
      failure = e;
    },
  });
  encoder.configure(config);

  const block = OPUS_GRANULE_RATE / 10; // 100 ms por AudioData
  for (let off = 0; off < pcm.length; off += block) {
    const slice = pcm.slice(off, Math.min(off + block, pcm.length));
    const data = new AudioData({
      format: "f32",
      sampleRate: OPUS_GRANULE_RATE,
      numberOfFrames: slice.length,
      numberOfChannels: 1,
      timestamp: Math.round((off / OPUS_GRANULE_RATE) * 1_000_000),
      data: slice,
    });
    encoder.encode(data);
    data.close();
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
  if (packets.length === 0) throw new Error("El codificador no produjo audio");

  return muxOggOpus(packets, {
    channels: 1,
    preSkip: preSkipFrom(description),
    inputSampleRate: inputRate,
    totalSamples: pcm.length,
  });
}
