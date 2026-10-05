import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 029 — cableado de la recuperación en Better Auth: token hasheado, 1 hora,
 * sesiones revocadas, `must_change_password` limpio, correo en segundo
 * plano, sin SMTP → RESET_PASSWORD_DISABLED, y límites por IP y por correo.
 * (El flujo completo contra Better Auth real lo cubre el E2E 029.)
 */

type AuthOptions = {
  emailAndPassword: {
    resetPasswordTokenExpiresIn: number;
    revokeSessionsOnPasswordReset: boolean;
    sendResetPassword: (data: {
      user: { id: string; email: string; name: string };
      url: string;
      token: string;
    }) => Promise<void>;
    onPasswordReset: (data: { user: { id: string } }) => Promise<void>;
  };
  verification: unknown;
  hooks: { before: (ctx: unknown) => Promise<void> };
};

let captured: AuthOptions | null = null;
let mailConfigured = true;
const queueSpy = vi.fn();
const clearSpy = vi.fn(async (_userId: string) => {});

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
  getEnv: () => ({ APP_BASE_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "x".repeat(32) }),
}));
vi.mock("@/lib/mail", () => ({ isMailConfigured: () => mailConfigured }));
vi.mock("@/server/auth/password-reset", () => ({
  queuePasswordResetEmail: (input: unknown) => queueSpy(input),
  clearMustChangePassword: (userId: string) => clearSpy(userId),
}));
vi.mock("@/server/auth/on-signup", () => ({
  onUserCreated: async () => {},
  resolveLoginOrganizationId: async () => null,
}));
vi.mock("@/server/auth/registration", () => ({
  hasAnyOrganization: async () => true,
  isPublicSignupAllowed: async () => false,
}));
vi.mock("@/server/auth/super-admin", () => ({ isSuperAdminEmail: () => false }));

import { getAuth } from "@/lib/auth";
import { resetRateLimit } from "@/lib/rate-limit";

function options(): AuthOptions {
  delete (globalThis as { __voceroAuth?: unknown }).__voceroAuth;
  captured = null;
  getAuth();
  if (!captured) throw new Error("betterAuth no fue llamado");
  return captured;
}

function ctx(path: string, body: unknown, ip = "1.1.1.1") {
  return { path, body, headers: new Headers({ "x-forwarded-for": ip }) };
}

beforeEach(() => {
  mailConfigured = true;
  queueSpy.mockReset();
  clearSpy.mockClear();
  resetRateLimit();
});

describe("opciones de Better Auth", () => {
  it("token de 1 hora, sesiones revocadas y token hasheado en reposo", () => {
    const o = options();
    expect(o.emailAndPassword.resetPasswordTokenExpiresIn).toBe(3600);
    expect(o.emailAndPassword.revokeSessionsOnPasswordReset).toBe(true);
    expect(o.verification).toEqual({
      storeIdentifier: { default: "plain", overrides: { "reset-password:": "hashed" } },
    });
  });

  it("sendResetPassword encola el correo con el token (no espera al SMTP)", async () => {
    const o = options();
    await o.emailAndPassword.sendResetPassword({
      user: { id: "u_1", email: "ana@empresa.com", name: "Ana" },
      url: "http://ignorado",
      token: "T0K",
    });
    expect(queueSpy).toHaveBeenCalledWith({ email: "ana@empresa.com", name: "Ana", token: "T0K" });
  });

  it("onPasswordReset limpia must_change_password", async () => {
    await options().emailAndPassword.onPasswordReset({ user: { id: "u_9" } });
    expect(clearSpy).toHaveBeenCalledWith("u_9");
  });
});

describe("hook before: /request-password-reset", () => {
  it("sin SMTP → RESET_PASSWORD_DISABLED antes de buscar la cuenta", async () => {
    mailConfigured = false;
    const before = options().hooks.before;
    await expect(
      before(ctx("/request-password-reset", { email: "ana@empresa.com" }))
    ).rejects.toMatchObject({ body: expect.objectContaining({ code: "RESET_PASSWORD_DISABLED" }) });
  });

  it("5 pedidos por correo por hora; el 6.º → 429 (sin distinguir mayúsculas ni IP)", async () => {
    const before = options().hooks.before;
    for (let i = 0; i < 5; i++) {
      await before(ctx("/request-password-reset", { email: "Ana@Empresa.com" }, `10.0.0.${i}`));
    }
    await expect(
      before(ctx("/request-password-reset", { email: "ana@empresa.com " }, "10.0.0.99"))
    ).rejects.toMatchObject({ statusCode: 429 });
    // Otro correo sigue pudiendo.
    await before(ctx("/request-password-reset", { email: "beto@empresa.com" }, "10.0.0.99"));
  });

  it("10 pedidos por IP cada 10 minutos (como el login)", async () => {
    const before = options().hooks.before;
    for (let i = 0; i < 10; i++) {
      await before(ctx("/request-password-reset", { email: `p${i}@x.com` }, "2.2.2.2"));
    }
    await expect(
      before(ctx("/request-password-reset", { email: "otra@x.com" }, "2.2.2.2"))
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("/reset-password también tiene límite por IP", async () => {
    const before = options().hooks.before;
    for (let i = 0; i < 10; i++) {
      await before(ctx("/reset-password", { token: "t", newPassword: "12345678" }, "3.3.3.3"));
    }
    await expect(
      before(ctx("/reset-password", { token: "t", newPassword: "12345678" }, "3.3.3.3"))
    ).rejects.toMatchObject({ statusCode: 429 });
  });
});
