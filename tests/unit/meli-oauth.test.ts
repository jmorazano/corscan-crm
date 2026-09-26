import { createHash } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 025 (plan D2): OAuth de Mercado Libre — PKCE S256 DERIVADO del nonce del
 * state (sin almacenamiento, el verifier nunca viaja en la URL), redirect
 * fijo, y el refresh ROTATIVO: cada renovación devuelve un refresh nuevo.
 */

beforeAll(() => {
  process.env.APP_BASE_URL = "https://crm.test";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
  process.env.MELI_CLIENT_ID = "1234567890";
  process.env.MELI_CLIENT_SECRET = "secreto-de-la-app";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PKCE derivado", () => {
  it("el verifier es determinista por nonce, de 43 caracteres base64url", async () => {
    const { pkceVerifier } = await import("@/lib/meli/oauth");
    const a = pkceVerifier("nonce-1", "k");
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceVerifier("nonce-1", "k")).toBe(a);
    expect(pkceVerifier("nonce-2", "k")).not.toBe(a);
    // Sin el secreto no se reconstruye: otro secreto, otro verifier.
    expect(pkceVerifier("nonce-1", "otro")).not.toBe(a);
  });

  it("el challenge es SHA-256 base64url del verifier (S256)", async () => {
    const { pkceChallenge } = await import("@/lib/meli/oauth");
    const v = "verificador-de-prueba";
    expect(pkceChallenge(v)).toBe(createHash("sha256").update(v).digest("base64url"));
  });

  it("el secreto del state es distinto del de Google/Instagram", async () => {
    const { meliStateSecret } = await import("@/lib/meli/oauth");
    expect(meliStateSecret()).toBe("secret-de-test-suficiente:mercadolibre");
  });
});

describe("URL de autorización", () => {
  it("lleva response_type, client_id, redirect fijo, state y challenge S256", async () => {
    const { buildAuthUrl, redirectUri } = await import("@/lib/meli/oauth");
    const url = new URL(buildAuthUrl("st4te", "ch4llenge"));
    expect(url.origin + url.pathname).toBe("https://auth.mercadolibre.com.ar/authorization");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("1234567890");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri());
    expect(redirectUri()).toBe("https://crm.test/api/integrations/mercadolibre/callback");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("code_challenge")).toBe("ch4llenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("canje y refresh", () => {
  it("canjea el code con code_verifier y devuelve el user_id como texto", async () => {
    const calls: { url: string; body: URLSearchParams }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: new URLSearchParams(String(init.body)) });
        return Response.json({
          access_token: "APP_USR-1",
          refresh_token: "TG-1",
          expires_in: 21600,
          user_id: 987654321,
        });
      })
    );
    const { exchangeCode } = await import("@/lib/meli/oauth");
    const t = await exchangeCode("TG-code", "verificador");
    expect(t.accessToken).toBe("APP_USR-1");
    expect(t.refreshToken).toBe("TG-1");
    expect(t.userId).toBe("987654321");
    expect(t.expiresAt.getTime()).toBeGreaterThan(Date.now() + 21_000_000);
    expect(calls[0]!.url).toBe("https://api.mercadolibre.com/oauth/token");
    expect(calls[0]!.body.get("grant_type")).toBe("authorization_code");
    expect(calls[0]!.body.get("code_verifier")).toBe("verificador");
    expect(calls[0]!.body.get("client_secret")).toBe("secreto-de-la-app");
  });

  it("el refresh devuelve el refresh NUEVO (rotación)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ access_token: "APP_USR-2", refresh_token: "TG-2", expires_in: 21600, user_id: 1 })
      )
    );
    const { refreshTokens } = await import("@/lib/meli/oauth");
    const t = await refreshTokens("TG-1");
    expect(t.refreshToken).toBe("TG-2");
  });

  it("invalid_grant se tipa para marcar «requiere reconexión»; el resto es provider_error sin tokens", async () => {
    const { refreshTokens, MeliAuthError } = await import("@/lib/meli/oauth");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 })));
    await expect(refreshTokens("TG-viejo")).rejects.toMatchObject({ code: "invalid_grant" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "server_error", message: "falló APP_USR-secreto-123" }, { status: 500 }))
    );
    const err = await refreshTokens("TG-x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MeliAuthError);
    expect((err as InstanceType<typeof MeliAuthError>).code).toBe("provider_error");
  });

  it("redact tapa tokens de ML en los mensajes", async () => {
    const { redact } = await import("@/lib/meli/oauth");
    expect(redact("token APP_USR-123-abc y TG-999-xyz")).toBe("token APP_USR-*** y TG-***");
  });
});
