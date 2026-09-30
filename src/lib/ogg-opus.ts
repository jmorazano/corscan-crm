/**
 * Contenedor Ogg para paquetes Opus (027, RFC 7845). PURO: sin DOM ni I/O.
 *
 * WhatsApp solo muestra como NOTA DE VOZ un `.ogg` con Opus mono. El
 * navegador codifica Opus con WebCodecs (`voice-encode.ts`), que entrega
 * paquetes sueltos: acá se envuelven en páginas Ogg. Hacerlo a mano evita
 * una dependencia (y un WASM de 1 MB) para algo que son ~150 líneas bien
 * especificadas: cabeceras OpusHead/OpusTags, lacing, granulepos y CRC.
 */

/** Todo Ogg Opus cuenta muestras a 48 kHz, sea cual sea la entrada. */
export const OPUS_GRANULE_RATE = 48_000;
/** Retardo del codificador libopus a 48 kHz (6,5 ms): lo que el decoder descarta. */
export const DEFAULT_PRE_SKIP = 312;
/** Paquetes por página: ~1 s de audio con cuadros de 20 ms. */
const PACKETS_PER_PAGE = 50;

/* ============================================================
 * CRC-32 de Ogg (polinomio 0x04C11DB7, sin reflejar, semilla 0)
 * ============================================================ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

export function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]!) >>> 0;
  return crc >>> 0;
}

/* ============================================================
 * Duración de un paquete Opus (TOC, RFC 6716 §3.1)
 * ============================================================ */

/** Muestras (a 48 kHz) que decodifica un paquete; 0 si está vacío. */
export function opusPacketSamples(packet: Uint8Array): number {
  if (packet.length === 0) return 0;
  const toc = packet[0]!;
  const config = toc >> 3;
  let frameMs: number;
  if (config < 12) frameMs = [10, 20, 40, 60][config % 4]!;
  else if (config < 16) frameMs = [10, 20][config % 2]!;
  else frameMs = [2.5, 5, 10, 20][config % 4]!;
  const code = toc & 0x03;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 0) & 0x3f : 2;
  return Math.round(frames * frameMs * 48);
}

/* ============================================================
 * Cabeceras
 * ============================================================ */

function u16(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}
function ascii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0));
}

export function opusHead(opts: { channels: number; preSkip: number; inputSampleRate: number }): Uint8Array {
  return new Uint8Array([
    ...ascii("OpusHead"),
    1, // versión
    opts.channels,
    ...u16(opts.preSkip),
    ...u32(opts.inputSampleRate),
    ...u16(0), // ganancia de salida
    0, // mapeo de canales 0: mono/estéreo
  ]);
}

export function opusTags(vendor = "Vocero CRM"): Uint8Array {
  const v = new TextEncoder().encode(vendor);
  return new Uint8Array([...ascii("OpusTags"), ...u32(v.length), ...v, ...u32(0)]);
}

/* ============================================================
 * Páginas
 * ============================================================ */

type PageInput = {
  packets: Uint8Array[];
  granule: number;
  serial: number;
  sequence: number;
  bos?: boolean;
  eos?: boolean;
};

function lacing(len: number): number[] {
  const out: number[] = [];
  let rest = len;
  while (rest >= 255) {
    out.push(255);
    rest -= 255;
  }
  out.push(rest);
  return out;
}

function page(p: PageInput): Uint8Array {
  const segments = p.packets.flatMap((pk) => lacing(pk.length));
  if (segments.length > 255) throw new Error("demasiados segmentos para una página Ogg");
  const bodyLen = p.packets.reduce((n, pk) => n + pk.length, 0);
  const out = new Uint8Array(27 + segments.length + bodyLen);
  out.set(ascii("OggS"), 0);
  out[4] = 0; // versión
  out[5] = (p.bos ? 0x02 : 0) | (p.eos ? 0x04 : 0);
  // granulepos de 64 bits (entero seguro de JS alcanza para horas de audio)
  const g = BigInt(p.granule);
  for (let i = 0; i < 8; i++) out[6 + i] = Number((g >> BigInt(8 * i)) & 0xffn);
  out.set(u32(p.serial), 14);
  out.set(u32(p.sequence), 18);
  // CRC en 22..25 queda en 0 para calcularlo
  out[26] = segments.length;
  out.set(segments, 27);
  let off = 27 + segments.length;
  for (const pk of p.packets) {
    out.set(pk, off);
    off += pk.length;
  }
  out.set(u32(oggCrc(out)), 22);
  return out;
}

/**
 * Arma el `.ogg` completo: OpusHead (BOS), OpusTags y las páginas de audio;
 * la última lleva EOS. `totalSamples` (a 48 kHz) recorta el relleno del
 * último cuadro: el granulepos final dice cuánto se reproduce.
 */
export function muxOggOpus(
  packets: Uint8Array[],
  opts: {
    channels?: number;
    preSkip?: number;
    inputSampleRate?: number;
    totalSamples?: number;
    serial?: number;
  } = {}
): Uint8Array {
  const channels = opts.channels ?? 1;
  const preSkip = opts.preSkip ?? DEFAULT_PRE_SKIP;
  const serial = opts.serial ?? 0x566f6365; // «Voce»
  const audio = packets.filter((p) => p.length > 0);
  const pages: Uint8Array[] = [
    page({
      packets: [opusHead({ channels, preSkip, inputSampleRate: opts.inputSampleRate ?? OPUS_GRANULE_RATE })],
      granule: 0,
      serial,
      sequence: 0,
      bos: true,
    }),
    page({ packets: [opusTags()], granule: 0, serial, sequence: 1 }),
  ];

  const encoded = audio.reduce((n, p) => n + opusPacketSamples(p), 0);
  const playable =
    opts.totalSamples !== undefined ? Math.min(opts.totalSamples, encoded) : encoded;
  let samples = 0;
  let sequence = 2;
  for (let i = 0; i < audio.length; i += PACKETS_PER_PAGE) {
    const batch = audio.slice(i, i + PACKETS_PER_PAGE);
    samples += batch.reduce((n, p) => n + opusPacketSamples(p), 0);
    const last = i + PACKETS_PER_PAGE >= audio.length;
    pages.push(
      page({
        packets: batch,
        granule: preSkip + (last ? playable : samples),
        serial,
        sequence: sequence++,
        eos: last,
      })
    );
  }
  if (audio.length === 0) {
    // Sin audio: igual un stream válido que termina.
    pages.push(page({ packets: [], granule: preSkip, serial, sequence: sequence++, eos: true }));
  }

  const total = pages.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of pages) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/* ============================================================
 * Lectura (tests y verificación): páginas → paquetes
 * ============================================================ */

export type OggPage = {
  flags: number;
  granule: number;
  sequence: number;
  crcOk: boolean;
  packets: Uint8Array[];
};

/** Parser mínimo (paquetes que no cruzan páginas, como los que escribe `muxOggOpus`). */
export function parseOgg(bytes: Uint8Array): OggPage[] {
  const pages: OggPage[] = [];
  let off = 0;
  while (off + 27 <= bytes.length) {
    if (String.fromCharCode(...bytes.subarray(off, off + 4)) !== "OggS") break;
    const nseg = bytes[off + 26]!;
    const segs = bytes.subarray(off + 27, off + 27 + nseg);
    const bodyLen = segs.reduce((n, s) => n + s, 0);
    const end = off + 27 + nseg + bodyLen;
    const raw = new Uint8Array(bytes.subarray(off, end));
    const stored = raw[22]! | (raw[23]! << 8) | (raw[24]! << 16) | (raw[25]! << 24);
    raw.fill(0, 22, 26);
    let granule = 0n;
    for (let i = 7; i >= 0; i--) granule = (granule << 8n) | BigInt(bytes[off + 6 + i]!);
    const packets: Uint8Array[] = [];
    let p = off + 27 + nseg;
    let len = 0;
    for (const s of segs) {
      len += s;
      if (s < 255) {
        packets.push(bytes.subarray(p, p + len));
        p += len;
        len = 0;
      }
    }
    pages.push({
      flags: bytes[off + 5]!,
      granule: Number(granule),
      sequence: bytes[off + 18]! | (bytes[off + 19]! << 8),
      crcOk: (stored >>> 0) === oggCrc(raw),
      packets,
    });
    off = end;
  }
  return pages;
}
