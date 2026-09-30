import { describe, expect, it } from "vitest";
import {
  captionTravelsInline,
  checkChannelSupport,
  checkOutboundLocally,
  classifyOutboundFile,
  contentDisposition,
  formatFileSize,
  formatLabel,
  guessOutboundFile,
  outboundAccept,
  outboundAgentText,
  sanitizeFileName,
  servingPolicy,
  validateOutboundFile,
} from "@/lib/outbound-media";

const MB = 1024 * 1024;

function bytes(...parts: (string | number[])[]): Uint8Array {
  const chunks = parts.map((p) =>
    typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p)
  );
  return new Uint8Array(Buffer.concat([...chunks, Buffer.alloc(48)]));
}

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = bytes("RIFF", [0, 0, 0, 0], "WEBP");
const GIF = bytes("GIF89a");
const PDF = bytes("%PDF-1.7\n");
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04]);
const OLE = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ftyp = (brand: string) => bytes([0, 0, 0, 0x18], "ftyp", brand);
const WEBM = bytes([0x1a, 0x45, 0xdf, 0xa3], "....B\x82\x84webm");
const MP3_ID3 = bytes("ID3", [0x04, 0x00]);
const MP3_SYNC = bytes([0xff, 0xfb, 0x90, 0x44]);
const AMR = bytes("#!AMR\n");
const OGG_OPUS = (() => {
  const b = Buffer.alloc(64);
  b.write("OggS", 0, "latin1");
  b.write("OpusHead", 28, "latin1");
  return new Uint8Array(b);
})();
const OGG_VORBIS = (() => {
  const b = Buffer.alloc(64);
  b.write("OggS", 0, "latin1");
  b.write("\x01vorbis", 28, "latin1");
  return new Uint8Array(b);
})();
const WAV = bytes("RIFF", [0, 0, 0, 0], "WAVE");

describe("classifyOutboundFile — la firma binaria manda", () => {
  it.each([
    [JPEG, "foto.png", "image", "image/jpeg"],
    [PNG, "captura", "image", "image/png"],
    [WEBP, "x.webp", "image", "image/webp"],
    [GIF, "x.gif", "image", "image/gif"],
    [ftyp("heic"), "IMG_0001.HEIC", "image", "image/heic"],
    [PDF, "presupuesto.pdf", "document", "application/pdf"],
    [PDF, "sin-extension", "document", "application/pdf"],
    [
      ZIP,
      "informe.docx",
      "document",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    [
      ZIP,
      "planilla.XLSX",
      "document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    [OLE, "viejo.doc", "document", "application/msword"],
    [OLE, "viejo.xls", "document", "application/vnd.ms-excel"],
    [ftyp("isom"), "video.mp4", "video", "video/mp4"],
    [ftyp("qt  "), "IMG_0002.MOV", "video", "video/quicktime"],
    [ftyp("3gp5"), "clip.3gp", "video", "video/3gpp"],
    [ftyp("M4A "), "nota.m4a", "audio", "audio/mp4"],
    [ftyp("mp42"), "grabacion.m4a", "audio", "audio/mp4"],
    [WEBM, "x.webm", "video", "video/webm"],
    [MP3_ID3, "tema.mp3", "audio", "audio/mpeg"],
    [MP3_SYNC, "tema.mp3", "audio", "audio/mpeg"],
    [AMR, "nota.amr", "audio", "audio/amr"],
    [OGG_OPUS, "nota.ogg", "audio", "audio/ogg"],
    [WAV, "nota.wav", "audio", "audio/wav"],
    [new Uint8Array(Buffer.from("hola,mundo\n")), "datos.csv", "document", "text/plain"],
  ] as const)("%#: %s → %s %s", (b, name, kind, mime) => {
    const c = classifyOutboundFile(b, name);
    expect(c).not.toBeNull();
    expect(c!.kind).toBe(kind);
    expect(c!.mime).toBe(mime);
  });

  it("OGG: distingue Opus de Vorbis", () => {
    expect(classifyOutboundFile(OGG_OPUS, "a.ogg")!.opus).toBe(true);
    expect(classifyOutboundFile(OGG_VORBIS, "a.ogg")!.opus).toBe(false);
  });

  it("rechaza lo que ningún canal acepta", () => {
    expect(classifyOutboundFile(ZIP, "fotos.zip")).toBeNull();
    expect(classifyOutboundFile(OLE, "raro.msg")).toBeNull();
    expect(classifyOutboundFile(bytes("<html><script>"), "pagina.html")).toBeNull();
    expect(classifyOutboundFile(new Uint8Array(), "vacio.pdf")).toBeNull();
    // Un binario cualquiera renombrado a .txt (tiene bytes nulos).
    expect(classifyOutboundFile(bytes([0x01, 0x00, 0x02]), "trucho.txt")).toBeNull();
  });

  it("el sync de MPEG solo vale con extensión de audio", () => {
    expect(classifyOutboundFile(MP3_SYNC, "archivo.bin")).toBeNull();
  });

  it("un .docx renombrado a .pdf no pasa por PDF", () => {
    expect(classifyOutboundFile(ZIP, "trucho.pdf")).toBeNull();
  });
});

describe("checkChannelSupport — la matriz de cada canal", () => {
  const c = (b: Uint8Array, name: string, size: number) => ({
    ...classifyOutboundFile(b, name)!,
    size,
  });

  it("WhatsApp: JPG/PNG hasta 5 MB", () => {
    expect(checkChannelSupport("whatsapp", c(JPEG, "a.jpg", 5 * MB)).ok).toBe(true);
    const big = checkChannelSupport("whatsapp", c(JPEG, "a.jpg", 5 * MB + 1));
    expect(big).toMatchObject({ ok: false, status: 413, code: "too_large" });
    if (!big.ok) expect(big.error).toBe("La imagen supera el máximo de 5 MB de WhatsApp.");
  });

  it("WhatsApp no acepta WebP ni HEIC como imagen, y lo dice", () => {
    const webp = checkChannelSupport("whatsapp", c(WEBP, "a.webp", 1000));
    expect(webp).toMatchObject({ ok: false, status: 415 });
    if (!webp.ok) expect(webp.error).toMatch(/WebP.*JPG o PNG/);
    const heic = checkChannelSupport("whatsapp", c(ftyp("heic"), "a.heic", 1000));
    expect(heic.ok).toBe(false);
  });

  it("WhatsApp: MOV del iPhone se rechaza con el porqué", () => {
    const mov = checkChannelSupport("whatsapp", c(ftyp("qt  "), "a.mov", 1000));
    expect(mov.ok).toBe(false);
    if (!mov.ok) expect(mov.error).toMatch(/MP4/);
  });

  it("WhatsApp: OGG solo con Opus", () => {
    expect(checkChannelSupport("whatsapp", c(OGG_OPUS, "a.ogg", 1000)).ok).toBe(true);
    expect(checkChannelSupport("whatsapp", c(OGG_VORBIS, "a.ogg", 1000)).ok).toBe(false);
  });

  it("WhatsApp: documentos hasta 25 MB; video hasta 16 MB", () => {
    expect(checkChannelSupport("whatsapp", c(PDF, "a.pdf", 25 * MB)).ok).toBe(true);
    expect(checkChannelSupport("whatsapp", c(PDF, "a.pdf", 25 * MB + 1)).ok).toBe(false);
    expect(checkChannelSupport("whatsapp", c(ftyp("isom"), "a.mp4", 16 * MB)).ok).toBe(true);
    expect(checkChannelSupport("whatsapp", c(ftyp("isom"), "a.mp4", 16 * MB + 1)).ok).toBe(false);
  });

  it("Instagram: imagen hasta 8 MB, MOV sí, documentos solo PDF, MP3 no", () => {
    expect(checkChannelSupport("instagram", c(JPEG, "a.jpg", 8 * MB)).ok).toBe(true);
    expect(checkChannelSupport("instagram", c(ftyp("qt  "), "a.mov", MB)).ok).toBe(true);
    const docx = checkChannelSupport("instagram", c(ZIP, "a.docx", MB));
    expect(docx.ok).toBe(false);
    if (!docx.ok) expect(docx.error).toBe("Instagram solo acepta documentos PDF.");
    expect(checkChannelSupport("instagram", c(MP3_ID3, "a.mp3", MB)).ok).toBe(false);
    expect(checkChannelSupport("instagram", c(PDF, "a.pdf", 25 * MB)).ok).toBe(true);
  });
});

describe("validateOutboundFile", () => {
  it("devuelve tipo, MIME real y nombre saneado", () => {
    const v = validateOutboundFile(PDF, "../../Presupuesto «Casa».pdf", "whatsapp");
    expect(v).toEqual({
      ok: true,
      kind: "document",
      mime: "application/pdf",
      label: "PDF",
      fileName: "Presupuesto «Casa».pdf",
    });
  });

  it("vacío → 422; desconocido → 415 con lo que sí se puede", () => {
    expect(validateOutboundFile(new Uint8Array(), "a.pdf", "whatsapp")).toMatchObject({
      ok: false,
      status: 422,
    });
    const zip = validateOutboundFile(ZIP, "a.zip", "whatsapp");
    expect(zip).toMatchObject({ ok: false, status: 415 });
    if (!zip.ok) expect(zip.error).toContain("PDF, Word, Excel");
  });
});

describe("checkOutboundLocally — rechazo en el navegador", () => {
  it("por extensión, antes de subir", () => {
    expect(checkOutboundLocally({ name: "a.pdf", type: "", size: 100 }, "whatsapp")).toEqual({
      ok: true,
      kind: "document",
    });
    expect(checkOutboundLocally({ name: "a.zip", type: "", size: 100 }, "whatsapp").ok).toBe(false);
    expect(checkOutboundLocally({ name: "a.docx", type: "", size: 100 }, "instagram").ok).toBe(false);
    expect(checkOutboundLocally({ name: "a.jpg", type: "", size: 6 * MB }, "whatsapp").ok).toBe(false);
    expect(checkOutboundLocally({ name: "a.jpg", type: "", size: 0 }, "whatsapp").ok).toBe(false);
  });

  it("una captura pegada sin extensión usa el MIME declarado", () => {
    expect(guessOutboundFile("image", "image/png")?.kind).toBe("image");
    expect(checkOutboundLocally({ name: "", type: "image/png", size: 10 }, "whatsapp").ok).toBe(true);
  });
});

describe("outboundAccept", () => {
  it("WhatsApp: documentos Office sí, WebP no", () => {
    const a = outboundAccept("whatsapp").split(",");
    expect(a).toContain(".pdf");
    expect(a).toContain(".docx");
    expect(a).toContain("image/jpeg");
    expect(a).not.toContain(".webp");
    expect(a).not.toContain(".mov");
  });
  it("Instagram: PDF y MOV sí, Office no", () => {
    const a = outboundAccept("instagram").split(",");
    expect(a).toContain(".pdf");
    expect(a).toContain(".mov");
    expect(a).not.toContain(".docx");
  });
});

describe("sanitizeFileName", () => {
  it("sin rutas, controles ni caracteres de encabezado", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\x\\foto.jpg")).toBe("foto.jpg");
    expect(sanitizeFileName('a"b<c>\u0000\n.pdf')).toBe("abc.pdf");
    expect(sanitizeFileName(".env")).toBe("env");
  });
  it("largo: corta conservando la extensión", () => {
    const out = sanitizeFileName(`${"x".repeat(300)}.pdf`);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });
  it("sin nombre útil → archivo.<ext>", () => {
    expect(sanitizeFileName("", { mime: "application/pdf" })).toBe("archivo.pdf");
    expect(sanitizeFileName(null)).toBe("archivo");
  });
});

describe("servingPolicy — nada ejecutable inline", () => {
  it.each([
    ["text/html", "application/octet-stream", false],
    ["image/svg+xml", "application/octet-stream", false],
    ["application/xhtml+xml", "application/octet-stream", false],
    ["application/javascript", "application/octet-stream", false],
    ["application/pdf", "application/pdf", true],
    ["image/jpeg", "image/jpeg", true],
    ["video/mp4", "video/mp4", true],
    ["audio/ogg", "audio/ogg", true],
    ["text/plain", "text/plain; charset=utf-8", true],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      false,
    ],
  ])("%s → %s inline=%s", (mime, contentType, inline) => {
    expect(servingPolicy(mime)).toEqual({ contentType, inline });
  });
});

describe("contentDisposition", () => {
  it("ASCII de respaldo + UTF-8 (RFC 5987)", () => {
    expect(contentDisposition("attachment", "Presupuesto año (final).pdf")).toBe(
      "attachment; filename=\"Presupuesto a_o (final).pdf\"; filename*=UTF-8''Presupuesto%20a%C3%B1o%20%28final%29.pdf"
    );
  });
  it("sin nombre, solo el tipo", () => {
    expect(contentDisposition("inline", null)).toBe("inline");
  });
});

describe("formatos para la tarjeta", () => {
  it("formatFileSize", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(340 * 1024)).toBe("340 KB");
    expect(formatFileSize(1.25 * MB)).toBe("1,3 MB");
    expect(formatFileSize(null)).toBe("");
  });
  it("formatLabel", () => {
    expect(formatLabel("application/pdf", "a.pdf")).toBe("PDF");
    expect(formatLabel("application/octet-stream", "a.xlsx")).toBe("Excel");
    expect(formatLabel("application/octet-stream", null)).toBe("Archivo");
  });
});

describe("epígrafe y agente", () => {
  it("el epígrafe viaja en el adjunto solo en WhatsApp y no en audios", () => {
    expect(captionTravelsInline("whatsapp", "image")).toBe(true);
    expect(captionTravelsInline("whatsapp", "document")).toBe(true);
    expect(captionTravelsInline("whatsapp", "audio")).toBe(false);
    expect(captionTravelsInline("instagram", "image")).toBe(false);
  });

  it("un adjunto saliente no desaparece del historial del agente", () => {
    expect(outboundAgentText({ type: "document", text: null })).toBe(
      "[ADJUNTO] Le mandaste al cliente un documento."
    );
    expect(outboundAgentText({ type: "image", text: "Mirá la cabaña" })).toBe(
      "[ADJUNTO] Le mandaste al cliente una imagen.\nMirá la cabaña"
    );
    expect(outboundAgentText({ type: "video", text: null, status: "failed" })).toBe(
      "[ADJUNTO] Intentaste mandarle al cliente un video, pero no se entregó."
    );
  });

  it("el texto y las plantillas quedan como estaban", () => {
    expect(outboundAgentText({ type: "text", text: "Hola" })).toBe("Hola");
    expect(outboundAgentText({ type: "template", text: null })).toBeNull();
  });
});
