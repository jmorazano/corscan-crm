import { beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "better-auth/api";

/**
 * FR-017: POST /api/settings/password — cambio de contraseña propio vía
 * changePassword de better-auth (revocando otras sesiones) que limpia
 * must_change_password; Zod min 8 server-side.
 */

const changePasswordMock = vi.fn();
const userUpdates: Record<string, unknown>[] = [];

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth/session", () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireSession: () =>
      Promise.resolve({
        userId: "u_1",
        email: "compa@empresa.com",
        organizationId: "org_1",
        role: "member",
      }),
    requireSuperAdmin: () => Promise.reject(new Error("no usado aquí")),
    // La ruta usa la sesión SIN membresía: sirve también al super admin
    // sin organización (contrato admin-api.md).
    requireSessionUser: () =>
      Promise.resolve({ userId: "u_1", email: "compa@empresa.com" }),
    getSessionOrNull: () => Promise.resolve(null),
  };
});

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { changePassword: changePasswordMock } }),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      update: () => ({
        set: (v: Record<string, unknown>) => {
          userUpdates.push(v);
          return { where: () => Promise.resolve() };
        },
      }),
    }),
  };
});

import { POST } from "@/app/api/settings/password/route";

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/settings/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  changePasswordMock.mockReset();
  // returnHeaders: true → better-auth devuelve { headers } con el Set-Cookie
  // de la sesión nueva; la ruta debe reenviarlo al navegador.
  changePasswordMock.mockResolvedValue({
    headers: new Headers({ "set-cookie": "vocero.session=nueva; Path=/" }),
  });
  userUpdates.length = 0;
});

describe("POST /api/settings/password", () => {
  it("contraseña nueva de menos de 8 → 422 sin tocar auth", async () => {
    const res = await post({ currentPassword: "temporal123", newPassword: "corta12" });
    expect(res.status).toBe(422);
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("contraseña actual incorrecta → 403 y el flag NO se limpia", async () => {
    changePasswordMock.mockRejectedValue(
      new APIError("BAD_REQUEST", { message: "Invalid password" })
    );
    const res = await post({
      currentPassword: "equivocada",
      newPassword: "nueva-segura-1",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_current_password");
    expect(userUpdates).toHaveLength(0);
  });

  it("camino feliz: revoca otras sesiones y limpia must_change_password", async () => {
    const res = await post({
      currentPassword: "temporal123",
      newPassword: "nueva-segura-1",
    });
    expect(res.status).toBe(200);
    expect(changePasswordMock).toHaveBeenCalledOnce();
    const call = changePasswordMock.mock.calls[0]![0] as {
      body: { currentPassword: string; newPassword: string; revokeOtherSessions: boolean };
    };
    expect(call.body.revokeOtherSessions).toBe(true);
    expect(call.body.newPassword).toBe("nueva-segura-1");
    expect(userUpdates[0]).toMatchObject({ mustChangePassword: false });
    // La cookie de la sesión nueva viaja en la respuesta: sin esto el
    // navegador queda con una cookie muerta y rebota a /login.
    expect(res.headers.get("set-cookie")).toContain("vocero.session=");
  });
});
