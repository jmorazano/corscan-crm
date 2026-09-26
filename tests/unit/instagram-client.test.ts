import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 023: adaptador de Instagram. Lo que importa acá: los secretos jamás
 * aparecen en un error, el formato de Meta se acepta en sus dos variantes y
 * el envío con etiqueta de agente humano arma el cuerpo correcto.
 */

beforeAll(() => {
  process.env.APP_BASE_URL = "https://crm.test";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
  process.env.INSTAGRAM_APP_ID = "2135730170674257";
  process.env.INSTAGRAM_APP_SECRET = "ig-super-secreto-123";
});

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    })
  );
  return calls;
}

describe("buildInstagramAuthUrl", () => {
  it("pide SOLO los dos permisos del App Review y usa el redirect fijo", async () => {
    const { buildInstagramAuthUrl } = await import("@/lib/instagram/client");
    const url = new URL(buildInstagramAuthUrl("st"));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("2135730170674257");
    expect(url.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_manage_messages"
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://crm.test/api/integrations/instagram/callback"
    );
    expect(url.searchParams.get("state")).toBe("st");
  });
});

describe("intercambio de tokens", () => {
  it("acepta la respuesta con `data:[…]` y la plana", async () => {
    const { exchangeInstagramCode } = await import("@/lib/instagram/client");
    // Cuerpo crudo: un number de 17 dígitos en JS ya estaría redondeado.
    stubFetch(200, '{"data":[{"access_token":"short-1","user_id":17841400000000001}]}');
    expect(await exchangeInstagramCode("c")).toEqual({
      accessToken: "short-1",
      userId: "17841400000000001",
    });
    stubFetch(200, { access_token: "short-2", user_id: "42" });
    expect(await exchangeInstagramCode("c")).toEqual({ accessToken: "short-2", userId: "42" });
  });

  it("un error de Meta NO arrastra el secreto ni el code al mensaje", async () => {
    const { exchangeInstagramCode, InstagramApiError } = await import("@/lib/instagram/client");
    stubFetch(400, {
      error_type: "OAuthException",
      code: 400,
      error_message: "Invalid client_secret ig-super-secreto-123 for code AQBx-secret-code",
    });
    const err = await exchangeInstagramCode("AQBx-secret-code").catch((e) => e);
    expect(err).toBeInstanceOf(InstagramApiError);
    expect(err.message).not.toContain("ig-super-secreto-123");
    expect(err.message).not.toContain("AQBx-secret-code");
  });

  it("token largo: calcula el vencimiento con expires_in", async () => {
    const { exchangeLongLivedToken } = await import("@/lib/instagram/client");
    const calls = stubFetch(200, { access_token: "long", expires_in: 5184000 });
    const now = new Date("2026-09-25T00:00:00Z");
    const t = await exchangeLongLivedToken("short", now);
    expect(t.expiresAt.toISOString()).toBe("2026-11-24T00:00:00.000Z");
    expect(calls[0]!.url).toContain("grant_type=ig_exchange_token");
  });
});

describe("sendInstagramText", () => {
  it("texto simple y con etiqueta HUMAN_AGENT", async () => {
    const { sendInstagramText } = await import("@/lib/instagram/client");
    const calls = stubFetch(200, { recipient_id: "c1", message_id: "mid-1" });
    await sendInstagramText({ igUserId: "178", token: "tok", recipientId: "c1", text: "hola" });
    await sendInstagramText({
      igUserId: "178",
      token: "tok",
      recipientId: "c1",
      text: "hola",
      humanAgent: true,
    });
    expect(calls[0]!.url).toBe("https://graph.instagram.com/v25.0/178/messages");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      recipient: { id: "c1" },
      message: { text: "hola" },
    });
    expect(JSON.parse(String(calls[1]!.init.body))).toMatchObject({
      messaging_type: "MESSAGE_TAG",
      tag: "HUMAN_AGENT",
    });
  });

  it("clasifica los errores: autorización, caída y resto", async () => {
    const { sendInstagramText } = await import("@/lib/instagram/client");
    type ApiErr = import("@/lib/instagram/client").InstagramApiError;
    const send = (): Promise<ApiErr> =>
      sendInstagramText({ igUserId: "1", token: "tok-secreto-largo", recipientId: "c", text: "x" }).then(
        () => {
          throw new Error("se esperaba un error");
        },
        (e: ApiErr) => e
      );
    stubFetch(400, { error: { code: 190, message: "Error validating access token tok-secreto-largo" } });
    const auth = await send();
    expect(auth.isAuthError).toBe(true);
    expect(auth.message).not.toContain("tok-secreto-largo");
    stubFetch(503, { error: { code: 2, message: "down" } });
    expect((await send()).isUnavailable).toBe(true);
    stubFetch(400, { error: { code: 10, error_subcode: 2018278, message: "outside window" } });
    const window = await send();
    expect(window.isAuthError).toBe(false);
    expect(window.subcode).toBe(2018278);
  });
});

describe("hosts de adjuntos", () => {
  it("solo CDN de Meta/Instagram", async () => {
    const { isAllowedInstagramMediaHost } = await import("@/lib/instagram/client");
    expect(isAllowedInstagramMediaHost("lookaside.fbsbx.com")).toBe(true);
    expect(isAllowedInstagramMediaHost("scontent-gru1-1.cdninstagram.com")).toBe(true);
    expect(isAllowedInstagramMediaHost("scontent.xx.fbcdn.net")).toBe(true);
    expect(isAllowedInstagramMediaHost("evil.com")).toBe(false);
    expect(isAllowedInstagramMediaHost("cdninstagram.com.evil.com")).toBe(false);
    expect(isAllowedInstagramMediaHost("169.254.169.254")).toBe(false);
  });
});
