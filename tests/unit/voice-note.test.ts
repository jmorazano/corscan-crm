import { describe, expect, it } from "vitest";
import {
  audioFormatForMime,
  normalizeMime,
  sniffAudioMime,
  validateVoiceNote,
  VOICE_NOTE_MAX_BYTES,
} from "@/lib/voice-note";

/** 015 (US3): firma binaria manda; WebM se rechaza; tamaño acotado. */
function bytes(head: number[] | string, len = 64): Uint8Array {
  const b = new Uint8Array(len);
  if (typeof head === "string") {
    for (let i = 0; i < head.length; i++) b[i] = head.charCodeAt(i);
  } else head.forEach((v, i) => (b[i] = v));
  return b;
}
function wav(): Uint8Array {
  const b = bytes("RIFF");
  "WAVE".split("").forEach((c, i) => (b[8 + i] = c.charCodeAt(0)));
  return b;
}
function m4a(): Uint8Array {
  const b = bytes([0, 0, 0, 0x18]);
  "ftypM4A ".split("").forEach((c, i) => (b[4 + i] = c.charCodeAt(0)));
  return b;
}

describe("sniffAudioMime", () => {
  it("reconoce wav, m4a, ogg, flac, mp3 (ID3 y sync), aac (ADTS) y webm", () => {
    expect(sniffAudioMime(wav())).toBe("audio/wav");
    expect(sniffAudioMime(m4a())).toBe("audio/mp4");
    expect(sniffAudioMime(bytes("OggS"))).toBe("audio/ogg");
    expect(sniffAudioMime(bytes("fLaC"))).toBe("audio/flac");
    expect(sniffAudioMime(bytes("ID3"))).toBe("audio/mpeg");
    expect(sniffAudioMime(bytes([0xff, 0xfb]))).toBe("audio/mpeg");
    expect(sniffAudioMime(bytes([0xff, 0xf1]))).toBe("audio/aac");
    expect(sniffAudioMime(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe("audio/webm");
    expect(sniffAudioMime(bytes("hola mundo txt"))).toBeNull();
  });
});

describe("validateVoiceNote", () => {
  it("wav y m4a válidos con su formato para OpenRouter", () => {
    expect(validateVoiceNote(wav(), "audio/wav")).toEqual({ ok: true, mime: "audio/wav", format: "wav" });
    expect(validateVoiceNote(m4a(), "audio/mp4")).toEqual({ ok: true, mime: "audio/mp4", format: "m4a" });
  });
  it("webm → 415; texto → 415; vacío → 422; grande → 413", () => {
    expect(validateVoiceNote(bytes([0x1a, 0x45, 0xdf, 0xa3]), "audio/webm")).toMatchObject({ ok: false, status: 415 });
    expect(validateVoiceNote(bytes("hola mundo txt"), "text/plain")).toMatchObject({ ok: false, status: 415 });
    expect(validateVoiceNote(new Uint8Array(0), "audio/wav")).toMatchObject({ ok: false, status: 422 });
    expect(validateVoiceNote(new Uint8Array(VOICE_NOTE_MAX_BYTES + 1), "audio/wav")).toMatchObject({ ok: false, status: 413, code: "too_large" });
  });
  it("lo declarado no manda: un .txt renombrado con firma wav pasa como wav", () => {
    expect(validateVoiceNote(wav(), "text/plain")).toMatchObject({ ok: true, mime: "audio/wav" });
  });
});

describe("normalizeMime / audioFormatForMime", () => {
  it("quita codecs y resuelve alias", () => {
    expect(normalizeMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeMime("audio/x-m4a")).toBe("audio/mp4");
    expect(normalizeMime("audio/mp3")).toBe("audio/mpeg");
    expect(audioFormatForMime("audio/mpeg")).toBe("mp3");
    expect(audioFormatForMime("audio/ogg")).toBe("ogg");
  });
});
