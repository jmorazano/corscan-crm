import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FR-062 cableado en Better Auth: el rate limit propio y el limitador interno
 * de Better Auth usan la MISMA IP (`clientIp`). Con el `X-Forwarded-For` que
 * manda Railway (`<cliente>, <edge del CDN>`) el balde es por cliente.
 */

type AuthOptions = {
  advanced?: { ipAddress?: { ipAddressHeaders?: string[] } };
  hooks: { before: (ctx: unknown) => Promise<void> };
};

let captured: AuthOptions | null = null;

vi.mock("better-auth", () => ({
  betterAuth: (opts: AuthOptions) => {
    captured = opts;
    return {};
  },
}));
vi.mock("better-auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth/api")>();
  return { ...actual, createAuthMiddleware: (fn: unknown) => fn };
});
vi.mock("better-auth/adapters/drizzle", () => ({ drizzleAdapter: () => ({}) }));
vi.mock("better-auth/plugins", () => ({ organization: () => ({}) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}), schema: {} }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    APP_BASE_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "x".repeat(32),
  }),
}));
vi.mock("@/server/auth/on-signup", () => ({
  onUserCreated: async () => {},
  resolveLoginOrganizationId: async () => null,
}));
vi.mock("@/server/auth/registration", () => ({
  hasAnyOrganization: async () => true,
  isPublicSignupAllowed: async () => true,
}));
vi.mock("@/server/auth/super-admin", () => ({ isSuperAdminEmail: () => false }));

import { getAuth } from "@/lib/auth";
import { CLIENT_IP_HEADER } from "@/lib/client-ip";
import { AUTH_RATE_LIMIT, resetRateLimit } from "@/lib/rate-limit";

function options(): AuthOptions {
  delete (globalThis as { __voceroAuth?: unknown }).__voceroAuth;
  captured = null;
  getAuth();
  if (!captured) throw new Error("betterAuth no fue llamado");
  return captured;
}

function signIn(headers?: Record<string, string>) {
  return {
    path: "/sign-in/email",
    body: { email: "a@b.c", password: "x" },
    headers: headers ? new Headers(headers) : undefined,
  };
}

async function exhaust(before: AuthOptions["hooks"]["before"], xff: string) {
  for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
    await before(signIn({ "x-forwarded-for": xff }));
  }
}

beforeEach(() => resetRateLimit());

describe("FR-062: IP del rate limit de login", () => {
  it("el mismo cliente por edges distintos del CDN comparte balde → 429", async () => {
    const { before } = options().hooks;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      await before(
        signIn({ "x-forwarded-for": `203.0.113.7, 152.233.10.${i}` })
      );
    }
    await expect(
      before(signIn({ "x-forwarded-for": "203.0.113.7, 152.233.99.99" }))
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("clientes distintos detrás del mismo edge no se bloquean entre sí", async () => {
    const { before } = options().hooks;
    await exhaust(before, "203.0.113.7, 152.233.10.20");
    await expect(
      before(signIn({ "x-forwarded-for": "198.51.100.1, 152.233.10.20" }))
    ).resolves.toBeUndefined();
  });

  it("rotar la IPv6 dentro del mismo /64 no esquiva el límite", async () => {
    const { before } = options().hooks;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      await before(signIn({ "x-forwarded-for": `2001:db8:aa:bb::${i + 1}` }));
    }
    await expect(
      before(signIn({ "x-forwarded-for": "2001:db8:aa:bb:ffff::1" }))
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("sin headers (llamada interna) → balde compartido «local»", async () => {
    const { before } = options().hooks;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) await before(signIn());
    await expect(before(signIn())).rejects.toMatchObject({ statusCode: 429 });
  });

  it("el limitador interno de Better Auth lee el header que fija withClientIp", () => {
    expect(options().advanced?.ipAddress?.ipAddressHeaders).toEqual([
      CLIENT_IP_HEADER,
    ]);
  });
});
