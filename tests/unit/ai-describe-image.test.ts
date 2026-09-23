import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeImage, DEFAULT_TRANSCRIPTION_MODEL } from "@/lib/ai";

/** 020 (D7/D8): visión por el MISMO modelo multimodal de la transcripción. */
describe("describeImage", () => {
  const config = { token: "token-test", model: "agente", judgeModel: "juez" };
  const image = { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), mimeType: "image/jpeg" };

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

  it("manda la imagen como data URI y devuelve una línea de texto plano", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok('"un comprobante de transferencia bancaria"'));
    vi.stubGlobal("fetch", fetchMock);
    const r = await describeImage(config, image);
    expect(r).toEqual({ ok: true, text: "un comprobante de transferencia bancaria" });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.temperature).toBe(0);
    const user = body.messages.find((m: { role: string }) => m.role === "user");
    expect(user.content[1].type).toBe("image_url");
    expect(user.content[1].image_url.url).toBe(
      `data:image/jpeg;base64,${image.bytes.toString("base64")}`
    );
    expect(JSON.stringify(body)).not.toContain("token-test");
  });

  it("el prompt prohíbe copiar los datos sensibles del comprobante (defensa de origen)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok("una foto"));
    vi.stubGlobal("fetch", fetchMock);
    await describeImage(config, image);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    const system = body.messages.find((m: { role: string }) => m.role === "system").content;
    for (const term of ["CBU", "alias", "importes", "titulares", "DNI"]) {
      expect(system).toContain(term);
    }
  });

  it("sin transcriptionModel usa el default multimodal de producto", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok("una foto"));
    vi.stubGlobal("fetch", fetchMock);
    await describeImage(config, image);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.model).toBe(DEFAULT_TRANSCRIPTION_MODEL);
  });

  it("el sentinel de «no se entiende» es un fallo limpio, no texto inventado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok("[SIN_CONTENIDO]")));
    const r = await describeImage(config, image);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("empty");
  });

  it("un modelo que no acepta imágenes se reporta como tal, sin reintentar de más", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "image input not supported" } }), {
          status: 400,
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const r = await describeImage(config, image);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unsupported_image");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sin token no llama al proveedor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await describeImage({ ...config, token: "" }, image);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
