import { beforeAll, describe, expect, it } from "vitest";

/**
 * research D2: el `state` de OAuth va firmado (HMAC) y ligado a la sesión
 * que inició la conexión; expira a los 10 min. La URL de autorización pide
 * acceso offline con consentimiento (refresh token garantizado).
 */

beforeAll(() => {
  process.env.APP_BASE_URL = "https://crm.test";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
  process.env.GOOGLE_CLIENT_ID = "client-test.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-test";
});

describe("state OAuth firmado", () => {
  it("round-trip válido y ligado a org + usuario", async () => {
    const { signState, verifyState } = await import("@/lib/google/oauth");
    const state = signState({ orgId: "org_a", userId: "usr_1" }, "k");
    const parsed = verifyState(state, "k");
    expect(parsed?.orgId).toBe("org_a");
    expect(parsed?.userId).toBe("usr_1");
  });

  it("rechaza firma alterada, secreto distinto y expiración", async () => {
    const { signState, verifyState } = await import("@/lib/google/oauth");
    const state = signState({ orgId: "org_a", userId: "usr_1" }, "k", 1_000_000);
    expect(verifyState(state, "otra")).toBeNull();
    expect(verifyState(state + "x", "k")).toBeNull();
    expect(verifyState("basura", "k")).toBeNull();
    expect(verifyState(state, "k", 1_000_000 + 11 * 60 * 1000)).toBeNull();
    expect(verifyState(state, "k", 1_000_000 + 60 * 1000)).not.toBeNull();
  });

  it("buildAuthUrl pide offline + consent + scopes de calendario y redirect fijo", async () => {
    const { buildAuthUrl, redirectUri, GOOGLE_SCOPES } = await import("@/lib/google/oauth");
    const url = new URL(buildAuthUrl("st"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://crm.test/api/integrations/google-calendar/callback"
    );
    expect(redirectUri()).toBe("https://crm.test/api/integrations/google-calendar/callback");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_SCOPES.join(" "));
    expect(url.searchParams.get("scope")).toContain("calendar.events");
  });

  it("decodeIdTokenEmail lee el email del payload sin verificar firma", async () => {
    const { decodeIdTokenEmail } = await import("@/lib/google/oauth");
    const payload = Buffer.from(JSON.stringify({ email: "agenda@negocio.test" })).toString("base64url");
    expect(decodeIdTokenEmail(`h.${payload}.s`)).toBe("agenda@negocio.test");
    expect(decodeIdTokenEmail("nope")).toBeNull();
  });
});
