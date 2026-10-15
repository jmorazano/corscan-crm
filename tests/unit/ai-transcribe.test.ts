import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transcribeAudio, DEFAULT_TRANSCRIPTION_MODEL } from "@/lib/ai";
import { muxOggOpus } from "@/lib/ogg-opus";

/** Nota de voz OGG/Opus de `seconds` segundos (cuadros CELT de 20 ms). */
function oggVoice(seconds: number, packet: number[] = [0xf8, ...new Array<number>(39).fill(1)]) {
  const packets = Array.from({ length: seconds * 50 }, () => Uint8Array.from(packet));
  return { bytes: Buffer.from(muxOggOpus(packets, { inputSampleRate: 16000 })), format: "ogg" as const };
}

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

  it("manda el audio (base64, format) y después la consigna; sin temperatura fija; texto plano", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok('"Hola, quiero enseñarte algo."'));
    vi.stubGlobal("fetch", fetchMock);
    const r = await transcribeAudio({ ...config, transcriptionModel: "google/gemini-2.5-flash" }, audio);
    expect(r).toEqual({ ok: true, text: "Hola, quiero enseñarte algo." });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.model).toBe("google/gemini-2.5-flash");
    // Con temperatura 0 Gemini caía en bucles de repetición (oct-2026).
    expect(body).not.toHaveProperty("temperature");
    const user = body.messages.find((m: { role: string }) => m.role === "user");
    expect(user.content[0].type).toBe("input_audio");
    expect(user.content[0].input_audio.format).toBe("wav");
    expect(user.content[0].input_audio.data).toBe(audio.bytes.toString("base64"));
    expect(user.content[1]).toEqual({ type: "text", text: "Transcribí este audio." });
    expect(JSON.stringify(body)).not.toContain("token-test");
  });

  it("el sentinel queda SOLO para un audio sin voz; el ruido o la mala calidad no alcanzan", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok("texto"));
    vi.stubGlobal("fetch", fetchMock);
    await transcribeAudio(config, audio);
    const system = JSON.parse(fetchMock.mock.calls[0]![1].body as string).messages[0].content as string;
    expect(system).toContain("SOLO si en el audio no habla nadie");
    expect(system).toContain("Aunque haya ruido de fondo");
    expect(system).not.toMatch(/no se entiende, devolvé/);
  });

  it("quién habla: cliente por defecto, dueño en el Entrenador, equipo en lo que se envía", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ok("texto"));
    vi.stubGlobal("fetch", fetchMock);
    await transcribeAudio(config, audio);
    await transcribeAudio(config, audio, { speaker: "owner" });
    await transcribeAudio(config, audio, { speaker: "team" });
    const systems = fetchMock.mock.calls.map(
      (c) => JSON.parse(c[1].body as string).messages[0].content as string
    );
    expect(systems[0]).toContain("un cliente le mandó a un negocio");
    expect(systems[1]).toContain("el dueño o la dueña de un negocio le manda a su asistente");
    expect(systems[2]).toContain("alguien del equipo de un negocio le mandó a un cliente");
  });

  it("sin transcriptionModel usa el default de producto (nunca el del agente)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok("texto"));
    vi.stubGlobal("fetch", fetchMock);
    await transcribeAudio(config, audio);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).model).toBe(DEFAULT_TRANSCRIPTION_MODEL);
  });

  it("500 → reintenta hasta 3 veces y luego provider_error", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await transcribeAudio(config, audio);
    expect(r).toMatchObject({ ok: false, error: "provider_error" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("un hipo del proveedor (500, respuesta vacía) no tumba la nota", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 502 }))
      .mockResolvedValueOnce(ok(""))
      .mockResolvedValueOnce(ok("Hola, ¿tenés lugar?"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await transcribeAudio(config, audio)).toEqual({ ok: true, text: "Hola, ¿tenés lugar?" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
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

  it("un [SIN_CONTENIDO] se pide de nuevo: si el segundo transcribe, vale (incidente de oct-2026)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok("[SIN_CONTENIDO]"))
      .mockResolvedValueOnce(ok("Este número, hablame, ¿cómo te llamás?"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await transcribeAudio(config, audio)).toEqual({
      ok: true,
      text: "Este número, hablame, ¿cómo te llamás?",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("dos [SIN_CONTENIDO] (o solo marcas […]) → empty sin gastar el tercer intento; fences se limpian", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok("[SIN_CONTENIDO]")).mockResolvedValueOnce(ok("[…] […]"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await transcribeAudio(config, audio)).toMatchObject({ ok: false, error: "empty" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok("```\ncuando pregunten decí 150 mil\n```")));
    expect(await transcribeAudio(config, audio)).toEqual({ ok: true, text: "cuando pregunten decí 150 mil" });
  });

  it("un bucle de repetición se reintenta; si el siguiente sale bien, se usa ese", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(`No, con el número de ${"no, ".repeat(300)}`))
      .mockResolvedValueOnce(ok("No, con el número de esa, no."));
    vi.stubGlobal("fetch", fetchMock);
    expect(await transcribeAudio(config, audio)).toEqual({ ok: true, text: "No, con el número de esa, no." });
  });

  it("si todos los intentos entran en bucle, devuelve el bucle recortado (mejor que nada)", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ok(`No, con el número de ${"no, ".repeat(300)}`));
    vi.stubGlobal("fetch", fetchMock);
    expect(await transcribeAudio(config, audio)).toEqual({ ok: true, text: "No, con el número de no, no, no," });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("OGG: un texto más largo de lo que dura el audio es inventado → se pide de nuevo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok("Hola, ¿qué tal? Te hago una consulta. ".repeat(5)))
      .mockResolvedValueOnce(ok("Che, hola."));
    vi.stubGlobal("fetch", fetchMock);
    expect(await transcribeAudio(config, oggVoice(1))).toEqual({ ok: true, text: "Che, hola." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("OGG: si ningún intento es verosímil → empty (jamás una consulta inventada)", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ok("Hola, ¿cómo estás? Te hago una consulta. ".repeat(4)));
    vi.stubGlobal("fetch", fetchMock);
    const r = await transcribeAudio(config, oggVoice(1));
    expect(r).toMatchObject({ ok: false, error: "empty" });
    expect(!r.ok && r.detail).toContain("más largas de lo que dura el audio");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("OGG en silencio digital (micrófono muteado) → empty SIN llamar al proveedor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await transcribeAudio(config, oggVoice(3, [0xf8, 0xff, 0xfe]));
    expect(r).toMatchObject({ ok: false, error: "empty" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin token → not_configured sin tocar la red", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await transcribeAudio({ ...config, token: " " }, audio)).toMatchObject({ ok: false, error: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
