import { describe, expect, it } from "vitest";
import {
  agentTextFor,
  attachmentMarker,
  ATTACHMENT_MARKER,
  MEDIA_MAX_BYTES,
  planInboundMedia,
  sniffImageMime,
} from "@/lib/inbound-media";

/** 020: políticas puras de los adjuntos entrantes. */
describe("planInboundMedia", () => {
  it("descarga audio e imagen cuando el webhook trae el id", () => {
    expect(planInboundMedia("audio", "mid_1")).toEqual({
      kind: "process",
      type: "audio",
      maxBytes: MEDIA_MAX_BYTES.audio,
    });
    expect(planInboundMedia("image", "mid_2")).toEqual({
      kind: "process",
      type: "image",
      maxBytes: MEDIA_MAX_BYTES.image,
    });
  });

  it("no descarga video, documento ni sticker, pero el agente se entera", () => {
    for (const type of ["video", "document", "sticker"]) {
      expect(planInboundMedia(type, "mid")).toEqual({ kind: "acknowledge", type });
    }
  });

  it("sin media_id no hay nada que bajar, pero tampoco se pierde el mensaje", () => {
    expect(planInboundMedia("image", null)).toEqual({ kind: "acknowledge", type: "image" });
    expect(planInboundMedia("audio", undefined)).toEqual({ kind: "acknowledge", type: "audio" });
  });

  it("un mensaje de texto no tiene plan de medios", () => {
    expect(planInboundMedia("text", null)).toEqual({ kind: "none" });
    expect(planInboundMedia("location", null)).toEqual({ kind: "none" });
  });
});

describe("attachmentMarker", () => {
  const base = { mediaState: null, text: null, mediaSummary: null };

  it("un audio transcripto NO lleva marcador: su texto ES lo que dijo la persona", () => {
    expect(
      attachmentMarker({ ...base, type: "audio", mediaState: "ready", text: "hola, ¿hay lugar?" })
    ).toBeNull();
  });

  it("un audio que no se pudo transcribir pide que lo escriban (nunca silencio)", () => {
    const marker = attachmentMarker({ ...base, type: "audio", mediaState: "failed" });
    expect(marker).toContain(ATTACHMENT_MARKER);
    expect(marker).toMatch(/escrib/i);
  });

  it("una imagen leída entra como dato, con el resumen de la IA", () => {
    expect(
      attachmentMarker({
        ...base,
        type: "image",
        mediaState: "ready",
        mediaSummary: "un comprobante de transferencia bancaria",
      })
    ).toBe(`${ATTACHMENT_MARKER} El cliente mandó una imagen: un comprobante de transferencia bancaria`);
  });

  it("una imagen sin resumen no inventa: pide que le cuenten de qué se trata", () => {
    const marker = attachmentMarker({ ...base, type: "image", mediaState: "failed" });
    expect(marker).toMatch(/preguntale/i);
  });

  it("video, documento y sticker dicen qué llegó sin prometer abrirlo", () => {
    expect(attachmentMarker({ ...base, type: "video" })).toContain("un video");
    expect(attachmentMarker({ ...base, type: "document" })).toContain("un documento");
    expect(attachmentMarker({ ...base, type: "sticker" })).toContain("un sticker");
  });

  it("un mensaje de texto no lleva marcador", () => {
    expect(attachmentMarker({ ...base, type: "text", text: "hola" })).toBeNull();
  });
});

describe("agentTextFor", () => {
  const base = { mediaState: null, text: null, mediaSummary: null };

  it("junta el marcador y el epígrafe real del cliente", () => {
    const out = agentTextFor({
      ...base,
      type: "image",
      mediaState: "ready",
      mediaSummary: "un comprobante de transferencia",
      text: "acá te mando",
    });
    expect(out).toBe(
      `${ATTACHMENT_MARKER} El cliente mandó una imagen: un comprobante de transferencia\nacá te mando`
    );
  });

  it("un texto suelto pasa tal cual", () => {
    expect(agentTextFor({ ...base, type: "text", text: "hola" })).toBe("hola");
  });

  it("devuelve null cuando no hay absolutamente nada que decir", () => {
    expect(agentTextFor({ ...base, type: "text" })).toBeNull();
  });

  it("un entrante sin texto YA NO desaparece del historial del agente", () => {
    // Regresión de la causa raíz de 020: el pipeline filtraba por `text` y
    // un audio o una foto dejaban al agente mudo.
    expect(agentTextFor({ ...base, type: "audio", mediaState: "failed" })).not.toBeNull();
    expect(agentTextFor({ ...base, type: "image", mediaState: "failed" })).not.toBeNull();
    expect(agentTextFor({ ...base, type: "document" })).not.toBeNull();
  });
});

describe("sniffImageMime", () => {
  it("reconoce JPEG, PNG y WebP por su firma", () => {
    expect(sniffImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(
      sniffImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ).toBe("image/png");
    expect(sniffImageMime(Buffer.from("RIFF____WEBPVP8 "))).toBe("image/webp");
  });

  it("no acepta lo que no es imagen aunque lo declaren como tal", () => {
    expect(sniffImageMime(Buffer.from("no soy una imagen"))).toBeNull();
    expect(sniffImageMime(Uint8Array.from([1, 2]))).toBeNull();
  });
});
