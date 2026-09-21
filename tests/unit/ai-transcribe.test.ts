import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transcribeAudio, DEFAULT_TRANSCRIPTION_MODEL } from "@/lib/ai";

/** 015 (D9): transcripción por OpenRouter con `input_audio` base64. */
describe("transcribeAudio", () => {
  const config = { token: "token-test", model: "agente", judgeModel: "juez" };
  const audio = { bytes: Buffer.from("RIFFxxxxWAVE"), format: "wav" as const };

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

  it("manda texto + input_audio (base64, format) al modelo de transcripción y devuelve texto plano", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok('"Hola, quiero enseñarte algo."'));
    vi.stubGlobal("fetch", fetchMock);
    const r = await transcribeAudio({ ...config, transcriptionModel: "google/gemini-2.5-flash" }, audio);
    expect(r).toEqual({ ok: true, text: "Hola, quiero enseñarte algo." });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.model).toBe("google/gemini-2.5-flash");
    const user = body.messages.find((m: { role: string }) => m.role === "user");
    expect(user.content[0]).toEqual({ type: "text", text: "Transcribí este audio." });
    expect(user.content[1].type).toBe("input_audio");
    expect(user.content[1].input_audio.format).toBe("wav");
    expect(user.content[1].input_audio.data).toBe(audio.bytes.toString("base64"));
    expect(JSON.stringify(body)).not.toContain("token-test");
  });

  it("sin transcriptionModel usa el default de producto (nunca el del agente)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok("texto"));
    vi.stubGlobal("fetch", fetchMock);
    await transcribeAudio(config, audio);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).model).toBe(DEFAULT_TRANSCRIPTION_MODEL);
  });

  it("500 → reintenta una vez y luego provider_error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await transcribeAudio(config, audio);
    expect(r).toMatchObject({ ok: false, error: "provider_error" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("400 hablando de audio → unsupported_audio sin reintento", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "This model does not support audio input" } }), { status: 400 })
      );
    vi.stubGlobal("fetch", fetchMock);
    const r = await transcribeAudio(config, audio);
    expect(r).toMatchObject({ ok: false, error: "unsupported_audio" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sentinel [SIN_CONTENIDO] o vacío → empty; fences se limpian", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok("[SIN_CONTENIDO]")));
    expect(await transcribeAudio(config, audio)).toMatchObject({ ok: false, error: "empty" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok("```\ncuando pregunten decí 150 mil\n```")));
    expect(await transcribeAudio(config, audio)).toEqual({ ok: true, text: "cuando pregunten decí 150 mil" });
  });

  it("sin token → not_configured sin tocar la red", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await transcribeAudio({ ...config, token: " " }, audio)).toMatchObject({ ok: false, error: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
