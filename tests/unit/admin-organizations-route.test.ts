import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato admin-api.md sobre /api/admin/organizations: gate withSuperAdmin
 * (401 sin sesión, 403 forbidden para usuarios comunes), Zod 422 server-side
 * y mapeo de códigos del server (409 duplicate_email, 403 reserved_email).
 */

const requireSuperAdminMock = vi.fn();
const createMock = vi.fn();
const listMock = vi.fn();

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

vi.mock("@/server/admin/organizations", () => ({
  createOrganizationWithAdmin: (...args: unknown[]) => createMock(...args),
  listOrganizations: (...args: unknown[]) => listMock(...args),
}));

import { ForbiddenError, UnauthorizedError } from "@/lib/auth/session";
import { GET, POST } from "@/app/api/admin/organizations/route";

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/admin/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const VALID_BODY = {
  organizationName: "Masterbrand",
  admin: { name: "Socio", email: "socio@empresa.com", password: "temporal123" },
};

beforeEach(() => {
  requireSuperAdminMock.mockReset();
  requireSuperAdminMock.mockResolvedValue({
    userId: "u_sa",
    email: "duena@agencia.com",
  });
  createMock.mockReset();
  listMock.mockReset();
  listMock.mockResolvedValue([]);
});

describe("GET /api/admin/organizations", () => {
  it("sin sesión → 401 unauthorized", async () => {
    requireSuperAdminMock.mockRejectedValue(new UnauthorizedError());
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("usuario común → 403 forbidden (la sección existe, el acceso no)", async () => {
    requireSuperAdminMock.mockRejectedValue(new ForbiddenError());
    const res = await GET();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("super admin → 200 con el listado", async () => {
    listMock.mockResolvedValue([
      { id: "org_a", name: "Corscan", members: [] },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      organizations: [{ id: "org_a", name: "Corscan", members: [] }],
    });
  });
});

describe("POST /api/admin/organizations", () => {
  it("usuario común → 403 sin tocar el server", async () => {
    requireSuperAdminMock.mockRejectedValue(new ForbiddenError());
    const res = await post(VALID_BODY);
    expect(res.status).toBe(403);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("password de menos de 8 caracteres → 422 (Zod server-side)", async () => {
    const res = await post({
      ...VALID_BODY,
      admin: { ...VALID_BODY.admin, password: "corta12" },
    });
    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("body sin admin → 422", async () => {
    const res = await post({ organizationName: "Masterbrand" });
    expect(res.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("email duplicado → 409 duplicate_email", async () => {
    createMock.mockResolvedValue({
      ok: false,
      code: "duplicate_email",
      message: "Ya existe una cuenta con ese correo",
    });
    const res = await post(VALID_BODY);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("duplicate_email");
  });

  it("email reservado (FR-016) → 403 reserved_email", async () => {
    createMock.mockResolvedValue({
      ok: false,
      code: "reserved_email",
      message: "Ese correo está reservado",
    });
    const res = await post(VALID_BODY);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("reserved_email");
  });

  it("creación feliz → 200 { organizationId, slug }", async () => {
    createMock.mockResolvedValue({
      ok: true,
      organizationId: "org_nueva",
      slug: "masterbrand",
    });
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      organizationId: "org_nueva",
      slug: "masterbrand",
    });
    expect(createMock).toHaveBeenCalledWith(VALID_BODY);
  });
});
