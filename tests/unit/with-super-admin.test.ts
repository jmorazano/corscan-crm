import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * D2/contrato admin-api.md: withSuperAdmin resuelve la sesión SIN exigir
 * membresía y niega con 403 `forbidden` a todo el que no figure en
 * SUPER_ADMIN_EMAILS (sin la variable, 403 siempre).
 */

const getSessionMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } }),
}));

import { withSuperAdmin } from "@/lib/api";

afterEach(() => {
  vi.unstubAllEnvs();
  getSessionMock.mockReset();
});

function session(email: string) {
  return { user: { id: "u_1", email }, session: {} };
}

describe("withSuperAdmin", () => {
  it("sin sesión → 401", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "duena@agencia.com");
    getSessionMock.mockResolvedValue(null);
    const handler = withSuperAdmin(async () => Response.json({ ok: true }));
    const res = await handler();
    expect(res.status).toBe(401);
  });

  it("sesión de usuario común → 403 forbidden (no exige membresía)", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "duena@agencia.com");
    getSessionMock.mockResolvedValue(session("owner@empresa.com"));
    const inner = vi.fn(async () => Response.json({ ok: true }));
    const res = await withSuperAdmin(inner)();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
    expect(inner).not.toHaveBeenCalled();
  });

  it("sin SUPER_ADMIN_EMAILS configurada → 403 siempre", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "");
    getSessionMock.mockResolvedValue(session("duena@agencia.com"));
    const res = await withSuperAdmin(async () => Response.json({ ok: true }))();
    expect(res.status).toBe(403);
  });

  it("super admin pasa y recibe su contexto (case-insensitive)", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "Duena@Agencia.com");
    getSessionMock.mockResolvedValue(session("duena@agencia.com"));
    const inner = vi.fn(async (ctx: { userId: string; email: string }) =>
      Response.json(ctx)
    );
    const res = await withSuperAdmin(inner)();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "u_1",
      email: "duena@agencia.com",
    });
  });

  it("errores del handler → 500 sin stack", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "duena@agencia.com");
    getSessionMock.mockResolvedValue(session("duena@agencia.com"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await withSuperAdmin(async () => {
      throw new Error("boom");
    })();
    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});
