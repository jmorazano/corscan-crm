import { describe, expect, it } from "vitest";
import {
  FORWARD_MAX_MESSAGES,
  FORWARD_MAX_TARGETS,
  forwardCaption,
  forwardFileName,
  forwardInput,
  forwardNotice,
  forwardTargetState,
  forwardability,
  forwardabilityOfDto,
  summarizeForward,
  toggleForwardTarget,
} from "@/lib/forward";

/** 054: reenviar — qué se puede, a quién y cómo se cuenta el resultado. */

const base = { text: null, hasMedia: false, mediaState: null, contacts: null };

describe("forwardability", () => {
  it("texto y plantilla enviada, si tienen texto", () => {
    expect(forwardability({ ...base, type: "text", text: "Hola" })).toEqual({ ok: true, kind: "text" });
    expect(forwardability({ ...base, type: "template", text: "Tu reserva…" })).toEqual({ ok: true, kind: "text" });
    expect(forwardability({ ...base, type: "text", text: "   " }).ok).toBe(false);
  });

  it.each(["image", "video", "audio", "document"])("%s con el binario guardado", (type) => {
    expect(forwardability({ ...base, type, hasMedia: true })).toEqual({ ok: true, kind: "media" });
  });

  it("un adjunto sin binario dice por qué", () => {
    expect(forwardability({ ...base, type: "image", mediaState: "pending" })).toEqual({
      ok: false,
      reason: "La imagen todavía se está descargando",
    });
    expect(forwardability({ ...base, type: "document", mediaState: "failed" })).toEqual({
      ok: false,
      reason: "El documento no está guardado en el CRM",
    });
  });

  it("un PDF que la IA todavía está leyendo ya se puede reenviar", () => {
    expect(forwardability({ ...base, type: "document", hasMedia: true, mediaState: "pending" }).ok).toBe(true);
  });

  it("tarjeta de contacto solo con teléfono", () => {
    const contacts = [{ name: "Juan", phones: [{ phone: "+5493515550100" }] }];
    expect(forwardability({ ...base, type: "contacts", contacts })).toEqual({ ok: true, kind: "contacts" });
    expect(forwardability({ ...base, type: "contacts" }).ok).toBe(false);
    expect(forwardability({ ...base, type: "contacts", contacts: [{ name: "Juan", phones: [] }] }).ok).toBe(false);
  });

  it.each(["sticker", "reaction", "deleted", "comment", "story", "share", "location", "unsupported", "media_placeholder", "otro"])(
    "%s no se reenvía",
    (type) => {
      const verdict = forwardability({ ...base, type, text: "x", hasMedia: true });
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason.length).toBeGreaterThan(5);
    }
  );

  it("desde el DTO del hilo", () => {
    expect(
      forwardabilityOfDto({ type: "image", text: null, media: { url: "/x" }, mediaState: "ready", details: null }).ok
    ).toBe(true);
    expect(forwardabilityOfDto({ type: "image", text: null, media: null, mediaState: "failed", details: null }).ok).toBe(
      false
    );
  });
});

describe("forwardCaption / forwardFileName", () => {
  it("el epígrafe de imagen y video viaja", () => {
    expect(forwardCaption({ type: "image", text: " Frente de la cabaña ", fileName: null })).toBe("Frente de la cabaña");
  });
  it("la transcripción de un audio NO es epígrafe", () => {
    expect(forwardCaption({ type: "audio", text: "hola, quería consultar", fileName: null })).toBeNull();
  });
  it("un documento cuyo texto es su nombre no lo repite", () => {
    expect(forwardCaption({ type: "document", text: "contrato.pdf", fileName: "contrato.pdf" })).toBeNull();
    expect(forwardCaption({ type: "document", text: "Firmalo y mandámelo", fileName: "contrato.pdf" })).toBe(
      "Firmalo y mandámelo"
    );
  });
  it("nombre por defecto según el tipo", () => {
    expect(forwardFileName("image", null)).toBe("imagen");
    expect(forwardFileName("document", " contrato.pdf ")).toBe("contrato.pdf");
  });
});

describe("forwardTargetState", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

  it("WhatsApp: según la ventana de 24 h", () => {
    expect(forwardTargetState({ kind: "whatsapp", windowOpen: true }, now)).toEqual({ ok: true });
    const closed = forwardTargetState({ kind: "whatsapp", windowOpen: false }, now);
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.reason).toContain("plantilla");
  });

  it("Instagram: 24 h siempre; hasta 7 días solo con Human Agent", () => {
    const recent = { kind: "instagram" as const, windowOpen: true, lastInboundAt: hoursAgo(2) };
    const old = { kind: "instagram" as const, windowOpen: false, lastInboundAt: hoursAgo(48) };
    expect(forwardTargetState(recent, now, { instagramHumanAgent: false }).ok).toBe(true);
    expect(forwardTargetState(old, now, { instagramHumanAgent: false }).ok).toBe(false);
    expect(forwardTargetState(old, now, { instagramHumanAgent: true }).ok).toBe(true);
  });

  it("el Entrenador nunca es destino", () => {
    expect(forwardTargetState({ kind: "trainer", windowOpen: true }, now).ok).toBe(false);
  });
});

describe("toggleForwardTarget", () => {
  it("agrega, quita y frena en el tope de WhatsApp", () => {
    let picked: string[] = [];
    for (let i = 0; i < FORWARD_MAX_TARGETS; i++) picked = toggleForwardTarget(picked, `cv_${i}`).selected;
    expect(picked).toHaveLength(5);
    expect(toggleForwardTarget(picked, "cv_extra")).toEqual({ selected: picked, full: true });
    expect(toggleForwardTarget(picked, "cv_0").selected).toHaveLength(4);
  });
});

describe("forwardInput", () => {
  const ok = { sourceConversationId: "cv_a", messageIds: ["msg_1"], targetConversationIds: ["cv_b"] };
  it("acepta lo mínimo y quita repetidos", () => {
    const parsed = forwardInput.parse({ ...ok, messageIds: ["msg_1", "msg_1"], targetConversationIds: ["cv_b", "cv_b"] });
    expect(parsed.messageIds).toEqual(["msg_1"]);
    expect(parsed.targetConversationIds).toEqual(["cv_b"]);
  });
  it("rechaza vacío y por encima de los topes", () => {
    expect(forwardInput.safeParse({ ...ok, messageIds: [] }).success).toBe(false);
    expect(forwardInput.safeParse({ ...ok, targetConversationIds: [] }).success).toBe(false);
    expect(
      forwardInput.safeParse({ ...ok, targetConversationIds: Array.from({ length: FORWARD_MAX_TARGETS + 1 }, (_, i) => `cv_${i}`) })
        .success
    ).toBe(false);
    expect(
      forwardInput.safeParse({ ...ok, messageIds: Array.from({ length: FORWARD_MAX_MESSAGES + 1 }, (_, i) => `msg_${i}`) }).success
    ).toBe(false);
  });
});

describe("resultado", () => {
  const t = (name: string, sent: number, failed: number, error: string | null = null) => ({
    conversationId: `cv_${name}`,
    name,
    sent,
    failed,
    error,
  });
  it("suma y arma el aviso", () => {
    const all = summarizeForward([t("Ana", 2, 0), t("Luis", 2, 0)]);
    expect(all).toMatchObject({ sent: 4, failed: 0 });
    expect(forwardNotice(all)).toBe("Reenviado a 2 chats");
    expect(forwardNotice(summarizeForward([t("Ana", 1, 0)]))).toBe("Reenviado a Ana");
    expect(forwardNotice(summarizeForward([t("Ana", 1, 0), t("Luis", 0, 1, "Ventana cerrada")]))).toBe(
      "Reenviado a Ana, con errores"
    );
    expect(forwardNotice(summarizeForward([t("Luis", 0, 1, "Ventana cerrada")]))).toBe("No se pudo reenviar");
  });
});
