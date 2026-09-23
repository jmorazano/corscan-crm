import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadMediaBinary, fetchMediaHandle, MetaApiError } from "@/lib/meta/client";

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
