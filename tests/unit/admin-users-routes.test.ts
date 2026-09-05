import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato admin-api.md sobre /api/admin/organizations/[id]/users y
 * /api/admin/users/[id]/password: gate withSuperAdmin (401/403), Zod 422
 * server-side (min 8, rol inválido) y mapeo de códigos del server
 * (404 not_found, 409 duplicate_email, 403 reserved_email/forbidden).
 */

const requireSuperAdminMock = vi.fn();
const createUserMock = vi.fn();
const resetPasswordMock = vi.fn();

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

vi.mock("@/server/admin/users", () => ({
  createOrganizationUser: (...args: unknown[]) => createUserMock(...args),
  resetUserPassword: (...args: unknown[]) => resetPasswordMock(...args),
}));

import { ForbiddenError, UnauthorizedError } from "@/lib/auth/session";
import { POST as createUserRoute } from "@/app/api/admin/organizations/[id]/users/route";
import { POST as resetPasswordRoute } from "@/app/api/admin/users/[id]/password/route";

function postUser(orgId: string, body: unknown): Promise<Response> {
  return createUserRoute(
    new Request(`http://localhost/api/admin/organizations/${orgId}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: orgId }) }
  );
}

function postReset(userId: string, body: unknown): Promise<Response> {
  return resetPasswordRoute(
    new Request(`http://localhost/api/admin/users/${userId}/password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: userId }) }
  );
}

const VALID_USER = {
  name: "Compa",
  email: "compa@empresa.com",
  password: "temporal123",
  role: "member",
};

beforeEach(() => {
  requireSuperAdminMock.mockReset();
  requireSuperAdminMock.mockResolvedValue({
    userId: "u_sa",
    email: "duena@agencia.com",
  });
  createUserMock.mockReset();
  resetPasswordMock.mockReset();
});

describe("POST /api/admin/organizations/[id]/users", () => {
  it("sin sesión → 401 sin tocar el server", async () => {
    requireSuperAdminMock.mockRejectedValue(new UnauthorizedError());
    const res = await postUser("org_a", VALID_USER);
    expect(res.status).toBe(401);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("usuario común → 403 forbidden sin tocar el server", async () => {
    requireSuperAdminMock.mockRejectedValue(new ForbiddenError());
    const res = await postUser("org_a", VALID_USER);
    expect(res.status).toBe(403);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("password de menos de 8 caracteres → 422 (Zod server-side)", async () => {
    const res = await postUser("org_a", { ...VALID_USER, password: "corta12" });
    expect(res.status).toBe(422);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("rol fuera de owner|member → 422", async () => {
    const res = await postUser("org_a", { ...VALID_USER, role: "admin" });
    expect(res.status).toBe(422);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("org inexistente → 404 not_found", async () => {
    createUserMock.mockResolvedValue({
      ok: false,
      code: "not_found",
      message: "La empresa no existe",
    });
    const res = await postUser("org_fantasma", VALID_USER);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("email duplicado → 409 duplicate_email", async () => {
    createUserMock.mockResolvedValue({
      ok: false,
      code: "duplicate_email",
      message: "Ya existe una cuenta con ese correo",
    });
    const res = await postUser("org_a", VALID_USER);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("duplicate_email");
  });

  it("email reservado (FR-016) → 403 reserved_email", async () => {
    createUserMock.mockResolvedValue({
      ok: false,
      code: "reserved_email",
      message: "Ese correo está reservado",
    });
    const res = await postUser("org_a", VALID_USER);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("reserved_email");
  });

  it("feliz → 201 con la org del path plumbeada al server", async () => {
    createUserMock.mockResolvedValue({ ok: true, userId: "u_nuevo" });
    const res = await postUser("org_a", VALID_USER);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(createUserMock).toHaveBeenCalledWith({
      organizationId: "org_a",
      ...VALID_USER,
    });
  });
});

describe("POST /api/admin/users/[id]/password", () => {
  it("sin sesión → 401 sin tocar el server", async () => {
    requireSuperAdminMock.mockRejectedValue(new UnauthorizedError());
    const res = await postReset("u_1", { password: "temporal456" });
    expect(res.status).toBe(401);
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it("usuario común → 403 forbidden sin tocar el server", async () => {
    requireSuperAdminMock.mockRejectedValue(new ForbiddenError());
    const res = await postReset("u_1", { password: "temporal456" });
    expect(res.status).toBe(403);
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it("password de menos de 8 caracteres → 422 (Zod server-side)", async () => {
    const res = await postReset("u_1", { password: "corta12" });
    expect(res.status).toBe(422);
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it("usuario inexistente → 404 not_found", async () => {
    resetPasswordMock.mockResolvedValue({
      ok: false,
      code: "not_found",
      message: "El usuario no existe",
    });
    const res = await postReset("u_fantasma", { password: "temporal456" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("super admin ajeno → 403 forbidden", async () => {
    resetPasswordMock.mockResolvedValue({
      ok: false,
      code: "forbidden",
      message: "No se puede restablecer la contraseña de otro super admin",
    });
    const res = await postReset("u_sa2", { password: "temporal456" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
  });

  it("feliz → 200 con el email del operador plumbeado (regla super admin ajeno)", async () => {
    resetPasswordMock.mockResolvedValue({ ok: true });
    const res = await postReset("u_1", { password: "temporal456" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(resetPasswordMock).toHaveBeenCalledWith({
      userId: "u_1",
      password: "temporal456",
      operatorEmail: "duena@agencia.com",
    });
  });
});
