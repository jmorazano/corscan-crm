import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRE_SKIP,
  muxOggOpus,
  oggCrc,
  oggOpusStats,
  opusHead,
  opusPacketSamples,
  parseOgg,
} from "@/lib/ogg-opus";
import { classifyOutboundFile, validateOutboundFile } from "@/lib/outbound-media";

/** 027: el contenedor de la nota de voz de WhatsApp (RFC 7845). */

/** Paquete Opus de 20 ms (CELT FB, config 31, código 0) con relleno. */
function packet20ms(len = 40): Uint8Array {
  const p = new Uint8Array(len);
  p[0] = (31 << 3) | 0;
  return p;
}

describe("opusPacketSamples (TOC, RFC 6716 §3.1)", () => {
  it("duración por configuración y cantidad de cuadros", () => {
    expect(opusPacketSamples(new Uint8Array([(31 << 3) | 0]))).toBe(960); // CELT 20 ms
    expect(opusPacketSamples(new Uint8Array([(1 << 3) | 0]))).toBe(960); // SILK 20 ms
    expect(opusPacketSamples(new Uint8Array([(3 << 3) | 0]))).toBe(2880); // SILK 60 ms
    expect(opusPacketSamples(new Uint8Array([(16 << 3) | 0]))).toBe(120); // CELT 2,5 ms
    expect(opusPacketSamples(new Uint8Array([(31 << 3) | 1]))).toBe(1920); // 2 cuadros
    expect(opusPacketSamples(new Uint8Array([(31 << 3) | 3, 3]))).toBe(2880); // código 3 × 3
    expect(opusPacketSamples(new Uint8Array())).toBe(0);
  });
});

describe("oggCrc", () => {
  it("vector conocido: CRC de «OggS» con el polinomio de Ogg", () => {
    // Calculado con la definición (0x04C11DB7, sin reflejar, semilla 0).
    expect(oggCrc(new Uint8Array([]))).toBe(0);
    expect(oggCrc(new TextEncoder().encode("123456789"))).toBe(0x89a1897f);
  });
});

describe("muxOggOpus", () => {
  const packets = Array.from({ length: 120 }, () => packet20ms()); // 2,4 s
  const ogg = muxOggOpus(packets, { inputSampleRate: 48000, totalSamples: 120 * 960 - 500 });
  const pages = parseOgg(ogg);

  it("OpusHead en la primera página (BOS) y OpusTags en la segunda", () => {
    expect(pages[0]!.flags & 0x02).toBe(0x02);
    const head = pages[0]!.packets[0]!;
    expect(String.fromCharCode(...head.subarray(0, 8))).toBe("OpusHead");
    expect(head[9]).toBe(1); // mono
    expect(head[10]! | (head[11]! << 8)).toBe(DEFAULT_PRE_SKIP);
    expect(String.fromCharCode(...pages[1]!.packets[0]!.subarray(0, 8))).toBe("OpusTags");
    expect(pages[0]!.granule).toBe(0);
    expect(pages[1]!.granule).toBe(0);
  });

  it("todas las páginas con CRC válido, secuencia correlativa y EOS al final", () => {
    expect(pages.every((p) => p.crcOk)).toBe(true);
    expect(pages.map((p) => p.sequence)).toEqual(pages.map((_, i) => i));
    expect(pages.at(-1)!.flags & 0x04).toBe(0x04);
    expect(pages.slice(0, -1).every((p) => (p.flags & 0x04) === 0)).toBe(true);
  });

  it("granulepos crece y el final recorta el relleno del último cuadro", () => {
    const audio = pages.slice(2);
    expect(audio.length).toBe(3); // 50 + 50 + 20 paquetes
    expect(audio[0]!.granule).toBe(DEFAULT_PRE_SKIP + 50 * 960);
    expect(audio[1]!.granule).toBe(DEFAULT_PRE_SKIP + 100 * 960);
    expect(audio[2]!.granule).toBe(DEFAULT_PRE_SKIP + 120 * 960 - 500);
    expect(audio.flatMap((p) => p.packets).length).toBe(120);
  });

  it("un paquete ≥255 bytes usa lacing de varios segmentos y se recupera entero", () => {
    const big = packet20ms(600);
    big[599] = 7;
    const out = parseOgg(muxOggOpus([big]));
    const got = out[2]!.packets[0]!;
    expect(got.length).toBe(600);
    expect(got[599]).toBe(7);
    expect(out.every((p) => p.crcOk)).toBe(true);
  });

  it("lo reconoce la validación de envío como OGG Opus que WhatsApp acepta", () => {
    expect(classifyOutboundFile(ogg, "nota-de-voz.ogg")).toMatchObject({
      kind: "audio",
      mime: "audio/ogg",
      opus: true,
    });
    expect(validateOutboundFile(ogg, "nota-de-voz.ogg", "whatsapp").ok).toBe(true);
    // Instagram no acepta OGG: por eso a Instagram va WAV.
    expect(validateOutboundFile(ogg, "nota-de-voz.ogg", "instagram").ok).toBe(false);
  });

  it("3 minutos a 16 kb/s quedan debajo de los 512 KB del ▶ de WhatsApp", () => {
    const threeMin = Array.from({ length: 9000 }, () => packet20ms(40)); // 16 kb/s × 20 ms
    expect(muxOggOpus(threeMin).length).toBeLessThan(512 * 1024);
  });
});

describe("oggOpusStats (nota de voz recibida)", () => {
  it("duración sin el pre-skip, paquetes de audio y de silencio", () => {
    const packets = [
      ...Array.from({ length: 40 }, () => packet20ms()),
      ...Array.from({ length: 10 }, () => Uint8Array.from([0xf8, 0xff, 0xfe])),
    ];
    const stats = oggOpusStats(muxOggOpus(packets, { inputSampleRate: 16000 }));
    expect(stats).toEqual({ durationMs: 1000, packets: 50, silentPackets: 10 });
  });

  it("tolera un paquete que cruza de página (WhatsApp lo hace) y usa el último granulepos", () => {
    // Página con un solo segmento de lacing, sin CRC (no se valida).
    const page = (segments: number[], body: Uint8Array, granule: bigint) => {
      const head = new Uint8Array(27 + segments.length);
      head.set([0x4f, 0x67, 0x67, 0x53]);
      new DataView(head.buffer).setBigUint64(6, granule, true);
      head[26] = segments.length;
      head.set(segments, 27);
      return Uint8Array.from([...head, ...body]);
    };
    const head = opusHead({ channels: 1, preSkip: 312, inputSampleRate: 16000 });
    const tags = new TextEncoder().encode("OpusTags........");
    const big = new Uint8Array(300).fill(7); // 255 en la página 3 + 45 en la 4
    const bytes = Uint8Array.from([
      ...page([head.length], head, 0n),
      ...page([tags.length], tags, 0n),
      ...page([255], big.subarray(0, 255), 0xffffffffffffffffn), // ningún paquete termina acá
      ...page([45, 2], Uint8Array.from([...big.subarray(255), 0xf8, 0xff]), BigInt(312 + 48_000 * 2)),
    ]);
    expect(oggOpusStats(bytes)).toEqual({ durationMs: 2000, packets: 2, silentPackets: 1 });
  });

  it("lo que no es OGG/Opus → null (quien lo usa sigue sin duración)", () => {
    expect(oggOpusStats(new TextEncoder().encode("RIFF....WAVEfmt "))).toBeNull();
    expect(oggOpusStats(new Uint8Array())).toBeNull();
    const vorbis = muxOggOpus([packet20ms()]);
    vorbis.set(new TextEncoder().encode("NotOpusH"), 28); // pisa la firma de OpusHead
    expect(oggOpusStats(vorbis)).toBeNull();
  });
});
