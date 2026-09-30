import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadMediaBinary,
  fetchMediaHandle,
  MetaApiError,
  uploadWhatsAppMedia,
} from "@/lib/meta/client";

/**
 * 020 (D2): la URL del binario sale de un payload EXTERNO (respuesta de Meta,
 * originada en un webhook) y termina en un `fetch` del servidor. Sin
 * allowlist de host, un webhook falsificado apunta ese fetch a donde quiera.
 */
describe("descarga de adjuntos de Meta", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("META_GRAPH_BASE_URL", "https://graph.facebook.com");
    vi.stubEnv("WA_MOCK_ENABLED", "false");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const binary = (bytes: Buffer, headers: Record<string, string> = {}) =>
    new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "content-type": "image/jpeg", ...headers },
    });

  it("fetchMediaHandle devuelve url, mime y tamaño declarado", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          url: "https://lookaside.fbcdn.net/x",
          mime_type: "audio/ogg; codecs=opus",
          file_size: "1234",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const handle = await fetchMediaHandle("mid_1", "token");
    expect(handle).toEqual({
      url: "https://lookaside.fbcdn.net/x",
      mimeType: "audio/ogg",
      fileSize: 1234,
    });
  });

  it("descarga de un host de Meta y manda Bearer + User-Agent", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(binary(Buffer.from("bytes")));
    vi.stubGlobal("fetch", fetchMock);
    const out = await downloadMediaBinary(
      "https://lookaside.fbcdn.net/whatsapp_business/attachments/?mid=1",
      "token-secreto",
      1024
    );
    expect(out.bytes.toString()).toBe("bytes");
    expect(out.contentType).toBe("image/jpeg");
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-secreto");
    // Sin User-Agent la CDN de Meta responde 403 aunque el token sea válido.
    expect(headers["User-Agent"]).toBeTruthy();
  });

  it("rechaza un host que no es de Meta SIN hacer el pedido", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      downloadMediaBinary("https://evil.example.com/payload", "token", 1024)
    ).rejects.toThrow(MetaApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rechaza un host que solo PARECE de Meta", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const url of [
      "https://fbcdn.net.evil.com/x",
      "https://notfbcdn.net/x",
      "https://lookaside.facebook.com.evil.com/x",
    ]) {
      await expect(downloadMediaBinary(url, "token", 1024)).rejects.toThrow(MetaApiError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rechaza IPs internas y esquemas que no son https", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "https://127.0.0.1/x",
      "file:///etc/passwd",
    ]) {
      await expect(downloadMediaBinary(url, "token", 1024)).rejects.toThrow(MetaApiError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("corta por tamaño con el content-length, antes de leer el cuerpo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(binary(Buffer.alloc(10), { "content-length": "99999" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      downloadMediaBinary("https://lookaside.fbcdn.net/x", "token", 1024)
    ).rejects.toThrow(/tamaño máximo/i);
  });

  it("corta por tamaño también cuando el servidor miente en el content-length", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(binary(Buffer.alloc(4096)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      downloadMediaBinary("https://lookaside.fbcdn.net/x", "token", 1024)
    ).rejects.toThrow(/tamaño máximo/i);
  });

  it("un medio vencido (404) es un error normal, no una excepción rara", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })));
    await expect(
      downloadMediaBinary("https://lookaside.fbcdn.net/x", "token", 1024)
    ).rejects.toThrow(/404/);
  });

  it("con el gate de mocks activo acepta además el host del wa-mock", async () => {
    // `getEnv` memoiza por módulo: hay que recargarlo para que tome la base
    // del mock (el resto del archivo ya la fijó en graph.facebook.com).
    vi.resetModules();
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("META_GRAPH_BASE_URL", "http://localhost:3000/api/dev/wa-mock/graph");
    const fetchMock = vi.fn().mockResolvedValueOnce(binary(Buffer.from("x")));
    vi.stubGlobal("fetch", fetchMock);
    const { downloadMediaBinary: download } = await import("@/lib/meta/client");
    const out = await download(
      "http://localhost:3000/api/dev/wa-mock/media/mediamock_image_1",
      "token",
      1024
    );
    expect(out.bytes.toString()).toBe("x");
  });
});

/** 026: subida de un adjunto para enviarlo (`POST {pn}/media`, multipart). */
describe("uploadWhatsAppMedia", () => {
  beforeEach(() => {
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://t:t@localhost:5432/t");
    vi.stubEnv("BETTER_AUTH_SECRET", "secret-de-test-suficiente");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-test");
    vi.stubEnv("META_GRAPH_BASE_URL", "https://graph.facebook.com");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("manda multipart con file/type/messaging_product y devuelve el id", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "media_123" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const id = await uploadWhatsAppMedia({
      phoneNumberId: "pn_1",
      token: "tok",
      bytes: Buffer.from("%PDF-1.4 hola"),
      mimeType: "application/pdf",
      fileName: "presupuesto.pdf",
    });
    expect(id).toBe("media_123");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/v\d+\.\d+\/pn_1\/media$/);
    expect(init.method).toBe("POST");
    // El boundary lo pone fetch: NO se fuerza Content-Type JSON.
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.headers.Authorization).toBe("Bearer tok");
    const form = init.body as FormData;
    expect(form.get("messaging_product")).toBe("whatsapp");
    expect(form.get("type")).toBe("application/pdf");
    const file = form.get("file") as File;
    expect(file.name).toBe("presupuesto.pdf");
    expect(file.type).toBe("application/pdf");
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe("%PDF-1.4 hola");
  });

  it("el rechazo de Meta llega como MetaApiError con el detalle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "(#131053) Media upload error",
              code: 131053,
              error_data: { details: "Unsupported file type" },
            },
          }),
          { status: 400 }
        )
      )
    );
    const err = await uploadWhatsAppMedia({
      phoneNumberId: "pn_1",
      token: "tok",
      bytes: Buffer.from("x"),
      mimeType: "image/jpeg",
      fileName: "a.jpg",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect((err as MetaApiError).code).toBe(131053);
    expect((err as MetaApiError).message).toContain("Unsupported file type");
    expect((err as MetaApiError).isAuthError).toBe(false);
  });
});

