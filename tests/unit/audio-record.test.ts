import { describe, expect, it } from "vitest";
import {
  encodeWav,
  fileNameFor,
  formatElapsed,
  pickRecorderMimeType,
} from "@/lib/audio-record";

/** 015 (US3): negociación del grabador y WAV de respaldo. */
describe("pickRecorderMimeType", () => {
  it("Safari/iOS y Chrome escritorio → audio/mp4", () => {
    expect(pickRecorderMimeType((t) => t === "audio/mp4" || t.startsWith("audio/webm"))).toBe("audio/mp4");
  });
  it("Firefox → ogg/opus", () => {
    expect(pickRecorderMimeType((t) => t.startsWith("audio/ogg"))).toBe("audio/ogg;codecs=opus");
  });
  it("Chromium sin AAC (solo webm) → null = fallback WAV", () => {
    expect(pickRecorderMimeType((t) => t.startsWith("audio/webm"))).toBeNull();
  });
  it("tolera isTypeSupported que lanza", () => {
    expect(
      pickRecorderMimeType(() => {
        throw new Error("nope");
      })
    ).toBeNull();
  });
});

describe("formatElapsed / fileNameFor", () => {
  it("mm:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7_400)).toBe("0:07");
    expect(formatElapsed(179_999)).toBe("2:59");
  });
  it("extensión por mime", () => {
    expect(fileNameFor("audio/mp4")).toBe("nota-de-voz.m4a");
    expect(fileNameFor("audio/ogg;codecs=opus")).toBe("nota-de-voz.ogg");
    expect(fileNameFor("audio/wav")).toBe("nota-de-voz.wav");
  });
});

describe("encodeWav", () => {
  it("cabecera RIFF/WAVE de 44 bytes, PCM16 mono, remuestreo 48k→16k", () => {
    const chunk = new Float32Array(48_000); // 1 s a 48 kHz
    for (let i = 0; i < chunk.length; i++) chunk[i] = Math.sin((2 * Math.PI * 440 * i) / 48_000) * 0.5;
    const out = encodeWav([chunk], 48_000, 16_000);
    const text = (o: number, n: number) => String.fromCharCode(...out.subarray(o, o + n));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(text(12, 4)).toBe("fmt ");
    expect(text(36, 4)).toBe("data");
    const v = new DataView(out.buffer);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(16_000 * 2); // 1 s a 16 kHz
    expect(out.length).toBe(44 + 16_000 * 2);
  });
  it("sin remuestreo cuando la tasa ya es baja", () => {
    const out = encodeWav([new Float32Array(8_000)], 8_000, 16_000);
    expect(new DataView(out.buffer).getUint32(24, true)).toBe(8_000);
    expect(out.length).toBe(44 + 8_000 * 2);
  });
});
