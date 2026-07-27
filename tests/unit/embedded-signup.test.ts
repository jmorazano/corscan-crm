import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Embedded Signup: intercambio del `code` y cierre del flujo.
 *
 * Lo que se protege aquí es el guardrail central: los ids que llegan del
 * browser NO se persisten si el token recién obtenido no puede leer ese
 * número. Un popup manipulado no debe poder secuestrar la conexión.
 */

const ORIGINAL_ENV = { ...process.env };

function setEnv() {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://x:x@localhost:5432/x";
  process.env.BETTER_AUTH_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-1234";
  process.env.META_APP_ID = "2262662764507422";
  process.env.META_APP_SECRET = "app-secret-test";
  process.env.META_ES_CONFIG_ID = "1051070220642813";
  process.env.META_GRAPH_BASE_URL = "https://graph.test";
  process.env.META_GRAPH_API_VERSION = "v25.0";
}

beforeEach(() => {
  vi.resetModules();
  setEnv();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("exchangeCodeForToken", () => {
  it("intercambia el code y devuelve el access_token", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ access_token: "EAAG-nuevo" }), {
          status: 200,
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { exchangeCodeForToken } = await import("@/lib/meta/client");
    await expect(exchangeCodeForToken("code-1")).resolves.toBe("EAAG-nuevo");

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/v25.0/oauth/access_token");
    expect(url).toContain("client_id=2262662764507422");
    expect(url).toContain("code=code-1");
  });

  it("el App Secret viaja en la query pero NUNCA en un header", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ access_token: "t" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { exchangeCodeForToken } = await import("@/lib/meta/client");
    await exchangeCodeForToken("code-1");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toBeUndefined();
    expect(init?.method).toBe("GET");
  });

  it("code vencido → MetaApiError con el mensaje de Meta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "This authorization code has expired.",
              type: "OAuthException",
              code: 100,
            },
          }),
          { status: 400 }
        )
      )
    );

    const { exchangeCodeForToken, MetaApiError } = await import(
      "@/lib/meta/client"
    );
    await expect(exchangeCodeForToken("code-viejo")).rejects.toBeInstanceOf(
      MetaApiError
    );
  });

  it("respuesta 200 sin access_token → error tipado, no undefined silencioso", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
    );

    const { exchangeCodeForToken, MetaApiError } = await import(
      "@/lib/meta/client"
    );
    await expect(exchangeCodeForToken("code-1")).rejects.toBeInstanceOf(
      MetaApiError
    );
  });

  it("red caída → status 0 (se traduce a meta_unavailable aguas arriba)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      })
    );

    const { exchangeCodeForToken, MetaApiError } = await import(
      "@/lib/meta/client"
    );
    await expect(exchangeCodeForToken("code-1")).rejects.toMatchObject({
      status: 0,
    });
    const { MetaApiError: E } = await import("@/lib/meta/client");
    expect(E).toBe(MetaApiError);
  });
});

describe("completeEmbeddedSignup", () => {
  type SaveInput = {
    organizationId: string;
    wabaId: string;
    phoneNumberId: string;
    token: string;
    displayPhoneNumber?: string | null;
    verifiedName?: string | null;
  };

  it("token válido para el número → guarda y suscribe", async () => {
    const saveCredentials = vi.fn(async (_input: SaveInput) => undefined);
    const subscribeAppToWaba = vi.fn(
      async (_wabaId: string, _token: string) => undefined
    );

    vi.doMock("@/lib/meta/client", async () => {
      const actual = await vi.importActual<typeof import("@/lib/meta/client")>(
        "@/lib/meta/client"
      );
      return { ...actual, exchangeCodeForToken: vi.fn(async () => "EAAG-ok") };
    });
    vi.doMock("@/server/whatsapp/connect", () => ({
      testConnection: vi.fn(async () => ({
        ok: true,
        displayPhoneNumber: "+54 9 351 688-2234",
        verifiedName: "CorScan",
      })),
      subscribeAppToWaba,
    }));
    vi.doMock("@/server/whatsapp/credentials", () => ({ saveCredentials }));

    const { completeEmbeddedSignup } = await import(
      "@/server/whatsapp/embedded-signup"
    );
    const res = await completeEmbeddedSignup({
      organizationId: "org_1",
      code: "code-1",
      wabaId: "waba_1",
      phoneNumberId: "pn_1",
    });

    expect(res.ok).toBe(true);
    expect(saveCredentials).toHaveBeenCalledOnce();
    expect(saveCredentials.mock.calls[0]?.[0]).toMatchObject({
      organizationId: "org_1",
      wabaId: "waba_1",
      phoneNumberId: "pn_1",
      token: "EAAG-ok",
    });
    expect(subscribeAppToWaba).toHaveBeenCalledWith("waba_1", "EAAG-ok");
  });

  it("GUARDRAIL: si el token no da acceso al número, NO persiste nada", async () => {
    const saveCredentials = vi.fn(async () => undefined);
    const subscribeAppToWaba = vi.fn(async () => undefined);

    vi.doMock("@/lib/meta/client", async () => {
      const actual = await vi.importActual<typeof import("@/lib/meta/client")>(
        "@/lib/meta/client"
      );
      return { ...actual, exchangeCodeForToken: vi.fn(async () => "EAAG-ok") };
    });
    vi.doMock("@/server/whatsapp/connect", () => ({
      testConnection: vi.fn(async () => ({
        ok: false,
        code: "invalid_token" as const,
        message: "no",
      })),
      subscribeAppToWaba,
    }));
    vi.doMock("@/server/whatsapp/credentials", () => ({ saveCredentials }));

    const { completeEmbeddedSignup } = await import(
      "@/server/whatsapp/embedded-signup"
    );
    const res = await completeEmbeddedSignup({
      organizationId: "org_1",
      code: "code-1",
      wabaId: "waba_ajeno",
      phoneNumberId: "pn_ajeno",
    });

    expect(res).toMatchObject({ ok: false, code: "invalid_assets" });
    expect(saveCredentials).not.toHaveBeenCalled();
    expect(subscribeAppToWaba).not.toHaveBeenCalled();
  });

  it("Meta caída en el intercambio → meta_unavailable, no exchange_failed", async () => {
    vi.doMock("@/lib/meta/client", async () => {
      const actual = await vi.importActual<typeof import("@/lib/meta/client")>(
        "@/lib/meta/client"
      );
      return {
        ...actual,
        exchangeCodeForToken: vi.fn(async () => {
          throw new actual.MetaApiError("caída", { status: 0 });
        }),
      };
    });
    vi.doMock("@/server/whatsapp/connect", () => ({
      testConnection: vi.fn(),
      subscribeAppToWaba: vi.fn(),
    }));
    vi.doMock("@/server/whatsapp/credentials", () => ({
      saveCredentials: vi.fn(),
    }));

    const { completeEmbeddedSignup } = await import(
      "@/server/whatsapp/embedded-signup"
    );
    const res = await completeEmbeddedSignup({
      organizationId: "org_1",
      code: "c",
      wabaId: "w",
      phoneNumberId: "p",
    });
    expect(res).toMatchObject({ ok: false, code: "meta_unavailable" });
  });
});

describe("isEmbeddedSignupConfigured", () => {
  it("con las tres variables → true", async () => {
    const { isEmbeddedSignupConfigured } = await import("@/lib/env");
    expect(isEmbeddedSignupConfigured()).toBe(true);
  });

  it("sin App Secret → false (no se puede cerrar el flujo)", async () => {
    delete process.env.META_APP_SECRET;
    const { isEmbeddedSignupConfigured } = await import("@/lib/env");
    expect(isEmbeddedSignupConfigured()).toBe(false);
  });

  it("sin config id → false", async () => {
    delete process.env.META_ES_CONFIG_ID;
    const { isEmbeddedSignupConfigured } = await import("@/lib/env");
    expect(isEmbeddedSignupConfigured()).toBe(false);
  });
});
