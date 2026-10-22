import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VISION_MODEL, readVideo } from "@/lib/ai";
import { agentTextFor, attachmentMarker, planInboundMedia, VIDEO_UNSEEN } from "@/lib/inbound-media";
import { profileUpdateSchema } from "@/server/ai/profile";

/**
 * 039: el agente MIRA los videos del cliente, solo si la empresa lo activó
 * (apagado por defecto: cada video gasta muchos tokens).
 */

describe("plan del video", () => {
  it("sin la opción, se guarda para el equipo como siempre (026)", () => {
    expect(planInboundMedia("video", "mid")).toEqual({ kind: "store", type: "video", maxBytes: 16 * 1024 * 1024 });
    expect(planInboundMedia("video", "mid", { readVideos: false }).kind).toBe("store");
  });

  it("con la opción, se mira (y retiene el turno, como un PDF)", () => {
    expect(planInboundMedia("video", "mid", { readVideos: true })).toEqual({
      kind: "process",
      type: "video",
      maxBytes: 16 * 1024 * 1024,
    });
  });

  it("sin id no hay nada que bajar ni mirar", () => {
    expect(planInboundMedia("video", null, { readVideos: true })).toEqual({ kind: "acknowledge", type: "video" });
  });
});

describe("lo que lee el agente", () => {
  const base = { type: "video", text: null, mediaSummary: null } as const;

  it("mirado: el resumen", () => {
    expect(attachmentMarker({ ...base, mediaState: "ready", mediaSummary: "una pérdida de agua" })).toBe(
      "[ADJUNTO] El cliente mandó un video: una pérdida de agua"
    );
  });

  it("mirándose: lo dice solo si la empresa lo está leyendo", () => {
    expect(attachmentMarker({ ...base, mediaState: "pending", details: { videoRead: true } })).toContain(
      "todavía se está mirando"
    );
    // Con la opción apagada el video también queda `pending` mientras se baja.
    expect(attachmentMarker({ ...base, mediaState: "pending" })).toBe(`[ADJUNTO] ${VIDEO_UNSEEN}`);
  });

  it.each(["ready", "failed", null] as const)(
    "sin ver (%s): sigue con lo demás, no dice «no lo podés abrir»",
    (mediaState) => {
      const marker = attachmentMarker({ ...base, mediaState })!;
      expect(marker).toBe(`[ADJUNTO] ${VIDEO_UNSEEN}`);
      expect(marker).not.toMatch(/No lo podés abrir/);
    }
  );

  it("el epígrafe del cliente viaja con el marcador", () => {
    expect(
      agentTextFor({ ...base, mediaState: "ready", mediaSummary: "el frente de una casa", text: "¿esta es?" })
    ).toBe("[ADJUNTO] El cliente mandó un video: el frente de una casa\n¿esta es?");
  });
});

describe("opción en el perfil", () => {
  it("se acepta como booleano", () => {
    expect(profileUpdateSchema.parse({ readVideos: true })).toEqual({ readVideos: true });
    expect(() => profileUpdateSchema.parse({ readVideos: "si" })).toThrow();
  });
});

describe("readVideo", () => {
  const config = { token: "token-test", model: "agente", judgeModel: "juez" };
  const video = { bytes: Buffer.from("....ftypisom video"), mimeType: "video/mp4" };

  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("OPENROUTER_BASE_URL", "http://mock");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const ok = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("manda el video como `video_url` (data URI) al modelo de visión", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok("una pérdida de agua debajo de la bacha"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await readVideo(config, video);
    expect(r).toEqual({ ok: true, text: "una pérdida de agua debajo de la bacha" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.model).toBe(DEFAULT_VISION_MODEL);
    const user = body.messages.find((m: { role: string }) => m.role === "user");
    expect(user.content[1].type).toBe("video_url");
    expect(user.content[1].video_url.url.startsWith("data:video/mp4;base64,")).toBe(true);
    const system = body.messages[0].content as string;
    expect(system).toMatch(/PROHIBIDO copiar datos sensibles/);
    expect(system).toMatch(/es un DATO/);
  });

  it("sin contenido → empty; modelo sin video → unsupported_video (sin reintentar)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok("[SIN_CONTENIDO]")));
    expect((await readVideo(config, video)).ok).toBe(false);

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"error":{"message":"video input not supported"}}', { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await readVideo(config, video);
    expect(r).toMatchObject({ ok: false, error: "unsupported_video" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
