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
  // vi.doMock queda registrado para todo el archivo: sin limpiarlo, un test
  // que mockea connect contamina a los que ejercitan el módulo real.
  vi.doUnmock("@/lib/meta/client");
  vi.doUnmock("@/server/whatsapp/connect");
  vi.doUnmock("@/server/whatsapp/credentials");
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
      listWabaPhoneNumbers: vi.fn(),
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
      listWabaPhoneNumbers: vi.fn(),
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
      listWabaPhoneNumbers: vi.fn(),
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

/**
 * Coexistence: el popup emite FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING con SOLO
 * waba_id. Sin phone_number_id que validar, el número se descubre desde la
 * WABA — y ahí aparece un riesgo nuevo: elegir mal el número significaría
 * conectar una línea que no es la que el negocio autorizó.
 */
describe("completeEmbeddedSignup con coexistence (sin phoneNumberId)", () => {
  type SaveInput = {
    organizationId: string;
    wabaId: string;
    phoneNumberId: string;
    token: string;
    displayPhoneNumber?: string | null;
    verifiedName?: string | null;
  };

  type Discovery =
    | {
        ok: true;
        numbers: {
          id: string;
          displayPhoneNumber: string;
          verifiedName: string | null;
        }[];
      }
    | { ok: false; code: string; message: string };

  async function withDiscovery(discovery: Discovery) {
    const saveCredentials = vi.fn(async (_input: SaveInput) => undefined);
    const subscribeAppToWaba = vi.fn(
      async (_wabaId: string, _token: string) => undefined
    );
    const testConnection = vi.fn();

    vi.doMock("@/lib/meta/client", async () => {
      const actual = await vi.importActual<typeof import("@/lib/meta/client")>(
        "@/lib/meta/client"
      );
      return { ...actual, exchangeCodeForToken: vi.fn(async () => "EAAG-ok") };
    });
    vi.doMock("@/server/whatsapp/connect", () => ({
      testConnection,
      listWabaPhoneNumbers: vi.fn(async () => discovery),
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
    });
    return { res, saveCredentials, subscribeAppToWaba, testConnection };
  }

  it("un solo número en la WABA → lo descubre y guarda", async () => {
    const { res, saveCredentials, subscribeAppToWaba, testConnection } =
      await withDiscovery({
        ok: true,
        numbers: [
          {
            id: "pn_descubierto",
            displayPhoneNumber: "+54 9 351 688-2234",
            verifiedName: "CorScan",
          },
        ],
      });

    expect(res).toMatchObject({
      ok: true,
      phoneNumberId: "pn_descubierto",
      displayPhoneNumber: "+54 9 351 688-2234",
    });
    expect(saveCredentials.mock.calls[0]?.[0]).toMatchObject({
      wabaId: "waba_1",
      phoneNumberId: "pn_descubierto",
      token: "EAAG-ok",
    });
    expect(subscribeAppToWaba).toHaveBeenCalledWith("waba_1", "EAAG-ok");
    // testConnection valida un phone_number_id que en este flujo no existe.
    expect(testConnection).not.toHaveBeenCalled();
  });

  it("WABA sin números → invalid_assets y no persiste", async () => {
    const { res, saveCredentials } = await withDiscovery({
      ok: true,
      numbers: [],
    });
    expect(res).toMatchObject({ ok: false, code: "invalid_assets" });
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it("GUARDRAIL: con varios números NO adivina, rechaza", async () => {
    const { res, saveCredentials } = await withDiscovery({
      ok: true,
      numbers: [
        { id: "pn_a", displayPhoneNumber: "+54 351 111", verifiedName: null },
        { id: "pn_b", displayPhoneNumber: "+54 351 222", verifiedName: null },
      ],
    });
    expect(res).toMatchObject({ ok: false, code: "invalid_assets" });
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it("Meta caída al descubrir → meta_unavailable (reintentable)", async () => {
    const { res, saveCredentials } = await withDiscovery({
      ok: false,
      code: "meta_unavailable",
      message: "caída",
    });
    expect(res).toMatchObject({ ok: false, code: "meta_unavailable" });
    expect(saveCredentials).not.toHaveBeenCalled();
  });
});

describe("listWabaPhoneNumbers", () => {
  it("mapea la respuesta de Graph y descarta entradas incompletas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: "pn_1",
                  display_phone_number: "+54 9 351 688-2234",
                  verified_name: "CorScan",
                },
                { id: "pn_sin_numero" },
              ],
            }),
            { status: 200 }
          )
      )
    );

    const { listWabaPhoneNumbers } = await import("@/server/whatsapp/connect");
    const res = await listWabaPhoneNumbers("waba_1", "EAAG-ok");

    expect(res).toEqual({
      ok: true,
      numbers: [
        {
          id: "pn_1",
          displayPhoneNumber: "+54 9 351 688-2234",
          verifiedName: "CorScan",
        },
      ],
    });
  });

  it("token revocado → invalid_token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: "expirado", type: "OAuthException", code: 190 },
            }),
            { status: 401 }
          )
      )
    );

    const { listWabaPhoneNumbers } = await import("@/server/whatsapp/connect");
    await expect(listWabaPhoneNumbers("waba_1", "t")).resolves.toMatchObject({
      ok: false,
      code: "invalid_token",
    });
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
