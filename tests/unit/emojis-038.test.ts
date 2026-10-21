import { describe, expect, it } from "vitest";
import {
  agentTextFor,
  attachmentMarker,
  isCustomerTurnMessage,
  reactionAgentText,
  reactionSnippet,
} from "@/lib/inbound-media";
import { messageTypeFor, parseInstagramWebhook } from "@/lib/instagram/webhook";
import {
  EMOJI_CATEGORIES,
  RECENT_MAX,
  insertAtCursor,
  parseRecent,
  pushRecent,
  searchEmojis,
} from "@/lib/emoji-catalog";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

/**
 * 038: el reclamo de los clientes era que ante un emoji (en la práctica, un
 * sticker o el corazón de Instagram) el agente contestaba «no puedo ver lo
 * que me mandaste». Y que desde el CRM no había cómo mandar emojis.
 */

const base = { mediaState: null, text: null, mediaSummary: null } as const;

describe("sticker para el agente", () => {
  it("visto: dice qué expresa y que es un gesto", () => {
    const marker = attachmentMarker({
      ...base,
      type: "sticker",
      mediaState: "ready",
      mediaSummary: "un pulgar arriba",
    });
    expect(marker).toContain("un pulgar arriba");
    expect(marker).toMatch(/emoji/);
  });

  it.each(["failed", "pending", null] as const)(
    "sin ver (%s): jamás le hace decir que no lo puede ver",
    (mediaState) => {
      const marker = attachmentMarker({ ...base, type: "sticker", mediaState })!;
      expect(marker).toContain("sticker");
      expect(marker).not.toMatch(/No lo podés abrir|preguntale de qué se trata/i);
      expect(marker).toMatch(/No le digas que no lo podés ver/);
    }
  );
});

describe("reacciones", () => {
  it("el agente las ve como contexto, con el mensaje reaccionado", () => {
    expect(reactionAgentText({ text: "👍", reactionTo: "¿Te reservo el martes?" })).toBe(
      "[REACCIÓN] El cliente reaccionó con 👍 a este mensaje: «¿Te reservo el martes?»."
    );
    expect(reactionAgentText({ text: null })).toContain("❤️ a un mensaje");
    expect(
      agentTextFor({
        type: "reaction",
        mediaState: null,
        text: "😂",
        mediaSummary: null,
        details: { reactionTo: "chiste" },
      })
    ).toContain("reaccionó con 😂");
  });

  it("una reacción no cuenta como mensaje que esperar respuesta", () => {
    expect(isCustomerTurnMessage({ direction: "in", type: "reaction" })).toBe(false);
    expect(isCustomerTurnMessage({ direction: "in", type: "sticker" })).toBe(true);
    expect(isCustomerTurnMessage({ direction: "in", type: "text" })).toBe(true);
    expect(isCustomerTurnMessage({ direction: "out", type: "text" })).toBe(false);
  });

  it("recorta el mensaje reaccionado sin partir emojis", () => {
    expect(reactionSnippet("  hola \n  che ")).toBe("hola che");
    expect(reactionSnippet(null)).toBeNull();
    const long = reactionSnippet("😀".repeat(100))!;
    expect(Array.from(long)).toHaveLength(81);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("Instagram", () => {
  const ACCOUNT = "17841400000000001";
  const CUSTOMER = "998877665544";
  const now = new Date("2026-10-21T12:00:00Z");
  type Events = NonNullable<ReturnType<typeof parseInstagramWebhook>>;
  const message = (msg: unknown) =>
    parseInstagramWebhook(
      {
        object: "instagram",
        entry: [{ id: ACCOUNT, time: 1, messaging: [{ sender: { id: CUSTOMER }, recipient: { id: ACCOUNT }, timestamp: 1, message: msg }] }],
      },
      now
    )![0] as Extract<Events[number], { kind: "message" }>;

  it("el corazón grande entra como el texto ❤️, no como adjunto", () => {
    const ev = message({ mid: "m1", attachments: [{ type: "like_heart" }] });
    expect(ev.text).toBe("❤️");
    expect(ev.attachments).toEqual([]);
    expect(messageTypeFor(ev)).toBe("text");
  });

  it("GIF o sticker del teclado = sticker", () => {
    expect(
      messageTypeFor({ text: null, attachments: [{ type: "animated_image", url: "https://x" }], isUnsupported: false })
    ).toBe("sticker");
  });
});

describe("prompt", () => {
  it("le dice al agente que interprete emojis y que las reacciones son contexto", () => {
    const prompt = buildAgentSystemPrompt({
      profile: { name: "Ari", tone: "", instructions: "", escalationRules: "", businessName: "Negocio" } as never,
      kb: [],
      stages: [],
    } as never);
    expect(prompt).toMatch(/solo con emojis o con un sticker/);
    expect(prompt).toMatch(/nunca digas que no podés verlos/);
    expect(prompt).toContain("[REACCIÓN]");
  });
});

describe("selector de emojis", () => {
  it("busca en español, sin tildes y por comienzo de palabra", () => {
    expect(searchEmojis("gracias")).toContain("🙏");
    expect(searchEmojis("ubicación")).toContain("📍");
    expect(searchEmojis("cor roj")).toEqual(["❤️"]);
    expect(searchEmojis("  ")).toEqual([]);
    expect(searchEmojis("zzzqqq")).toEqual([]);
  });

  it("el catálogo no tiene entradas vacías", () => {
    for (const c of EMOJI_CATEGORIES) {
      expect(c.emojis.length).toBeGreaterThan(0);
      for (const [emoji, keywords] of c.emojis) {
        expect(emoji.length).toBeGreaterThan(0);
        expect(keywords).toBe(keywords.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""));
      }
    }
  });

  it("inserta en el cursor o reemplaza la selección", () => {
    expect(insertAtCursor("hola che", "👋", { start: 4, end: 4 })).toEqual({ text: "hola👋 che", caret: 6 });
    expect(insertAtCursor("hola che", "😀", { start: 5, end: 8 })).toEqual({ text: "hola 😀", caret: 7 });
    expect(insertAtCursor("hola", "👍", null)).toEqual({ text: "hola👍", caret: 6 });
    expect(insertAtCursor("", "👍", { start: 99, end: 120 })).toEqual({ text: "👍", caret: 2 });
  });

  it("recientes: el último primero, sin repetidos, con tope y tolerando basura", () => {
    expect(pushRecent(["👍", "😀"], "😀")).toEqual(["😀", "👍"]);
    const many = Array.from({ length: 40 }, (_, i) => String(i));
    expect(pushRecent(many, "👍")).toHaveLength(RECENT_MAX);
    expect(parseRecent('["👍", 3, ""]')).toEqual(["👍"]);
    expect(parseRecent("{roto")).toEqual([]);
    expect(parseRecent(null)).toEqual([]);
  });
});

describe("038: un aviso de formato no termina en silencio", () => {
  it("reconoce el motivo que es un artefacto del reintento", async () => {
    const { isFormatArtifactReason } = await import("@/server/ai/actions");
    expect(isFormatArtifactReason("previous response was not valid JSON")).toBe(true);
    expect(isFormatArtifactReason("mi respuesta anterior no fue válida según el esquema")).toBe(true);
    expect(isFormatArtifactReason("el cliente solo agradeció")).toBe(false);
    expect(isFormatArtifactReason(undefined)).toBe(false);
  });
});
