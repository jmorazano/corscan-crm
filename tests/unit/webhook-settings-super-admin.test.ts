import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * US2: los datos del webhook (URL + verify token) son un secreto DE
 * PLATAFORMA — con el token cualquiera puede inyectar mensajes falsos en la
 * bandeja de CUALQUIER organización (la firma de META_APP_SECRET es
 * opcional). El GET debe negarse a todo miembro común y servir solo al
 * super admin.
 */

const requireSuperAdminMock = vi.fn();

vi.mock("@/lib/auth/session", () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireSession: () => Promise.reject(new Error("no usado aquí")),
    requireSessionUser: () => Promise.reject(new Error("no usado aquí")),
    getSessionOrNull: () => Promise.resolve(null),
    requireSuperAdmin: (...args: unknown[]) => requireSuperAdminMock(...args),
  };
});

import { ForbiddenError, UnauthorizedError } from "@/lib/auth/session";

beforeAll(() => {
  process.env.APP_BASE_URL = "https://crm.ejemplo.com";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-secreto-de-plataforma";
});

beforeEach(() => {
  requireSuperAdminMock.mockReset();
});

describe("GET /api/settings/webhook (secreto de plataforma, US2)", () => {
  it("sin sesión → 401 y el token JAMÁS viaja", async () => {
    requireSuperAdminMock.mockRejectedValue(new UnauthorizedError());
    const { GET } = await import("@/app/api/settings/webhook/route");
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("verify-secreto-de-plataforma");
  });

  it("miembro común de una organización → 403 y el token JAMÁS viaja", async () => {
    requireSuperAdminMock.mockRejectedValue(new ForbiddenError());
    const { GET } = await import("@/app/api/settings/webhook/route");
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("verify-secreto-de-plataforma");
  });

  it("super admin → 200 con URL y verify token", async () => {
    requireSuperAdminMock.mockResolvedValue({
      userId: "u_sa",
      email: "duena@agencia.com",
    });
    const { GET } = await import("@/app/api/settings/webhook/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; verifyToken: string };
    expect(body.verifyToken).toBe("verify-secreto-de-plataforma");
    expect(body.url).toBe(
      "https://crm.ejemplo.com/api/webhooks/wa/verify-secreto-de-plataforma"
    );
  });
});
