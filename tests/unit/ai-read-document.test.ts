import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VISION_MODEL, readDocument } from "@/lib/ai";

/** 027: el PDF del cliente lo lee el modelo de VISIÓN, con defensa de origen. */
describe("readDocument", () => {
  const config = { token: "token-test", model: "agente", judgeModel: "juez" };
  const doc = { bytes: Buffer.from("%PDF-1.4 hola"), fileName: "Requisitos alquiler.pdf" };

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

  it("manda el PDF como parte `file` (data URI) al modelo de visión", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok("una lista de requisitos para alquilar"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await readDocument({ ...config, visionModel: "google/gemini-2.5-flash" }, doc);
    expect(r).toEqual({ ok: true, text: "una lista de requisitos para alquilar" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.model).toBe("google/gemini-2.5-flash");
    expect(body.temperature).toBe(0);
    const user = body.messages.find((m: { role: string }) => m.role === "user");
    expect(user.content[1]).toEqual({
      type: "file",
      file: {
        filename: "Requisitos alquiler.pdf",
        file_data: `data:application/pdf;base64,${doc.bytes.toString("base64")}`,
      },
    });
    expect(JSON.stringify(body)).not.toContain("token-test");
  });

  it("sin modelo de visión configurado usa el default de producto", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok("un plano"));
    vi.stubGlobal("fetch", fetchMock);
    await readDocument(config, doc);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).model).toBe(DEFAULT_VISION_MODEL);
  });

  it("el prompt prohíbe datos sensibles y trata el documento como DATO", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ok("un contrato"));
    vi.stubGlobal("fetch", fetchMock);
    await readDocument(config, doc);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    const system = body.messages.find((m: { role: string }) => m.role === "system").content;
    for (const term of ["CBU", "alias", "importes", "titulares", "DNI", "CUIT", "DATO"]) {
      expect(system).toContain(term);
    }
  });

  it("sentinel → `empty`; modelo que no acepta archivos → `unsupported_document`", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok("[SIN_CONTENIDO]")));
    const empty = await readDocument(config, doc);
    expect(empty).toMatchObject({ ok: false, error: "empty" });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "file input not supported by this model" } }), {
        status: 400,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const unsupported = await readDocument(config, doc);
    expect(unsupported).toMatchObject({ ok: false, error: "unsupported_document" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sin token → not_configured sin llamar al proveedor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await readDocument({ ...config, token: " " }, doc);
    expect(r).toMatchObject({ ok: false, error: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
