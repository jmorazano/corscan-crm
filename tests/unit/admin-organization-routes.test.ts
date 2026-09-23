import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 019: `GET /api/admin/organizations/[id]` (200 / 404) y
 * `DELETE /api/admin/organizations/[id]/users/[userId]` (200 con
 * accountDeleted, 404 not_found/not_member, 409 last_owner, 403 forbidden),
 * ambos bajo withSuperAdmin (401/403).
 */

const requireSuperAdminMock = vi.fn();
const getOrganizationMock = vi.fn();
const removeUserMock = vi.fn();

vi.mock("@/lib/auth/session", () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  class PasswordChangeRequiredError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    PasswordChangeRequiredError,
    requireSession: () => Promise.reject(new Error("no usado aquí")),
    requireSessionUser: () => Promise.reject(new Error("no usado aquí")),
    getSessionOrNull: () => Promise.resolve(null),
    requireSuperAdmin: (...args: unknown[]) => requireSuperAdminMock(...args),
  };
});

vi.mock("@/server/admin/organizations", () => ({
  getOrganization: (...args: unknown[]) => getOrganizationMock(...args),
  listOrganizations: () => Promise.resolve([]),
  createOrganizationWithAdmin: () => Promise.reject(new Error("no usado aquí")),
}));

vi.mock("@/server/admin/users", () => ({
  removeOrganizationUser: (...args: unknown[]) => removeUserMock(...args),
  createOrganizationUser: () => Promise.reject(new Error("no usado aquí")),
  resetUserPassword: () => Promise.reject(new Error("no usado aquí")),
}));

import { ForbiddenError, UnauthorizedError } from "@/lib/auth/session";
import { GET as getOrgRoute } from "@/app/api/admin/organizations/[id]/route";
import { DELETE as removeUserRoute } from "@/app/api/admin/organizations/[id]/users/[userId]/route";

const OPERATOR = { userId: "u_sa", email: "superadmin@vocero.test" };

function getOrg(id: string): Promise<Response> {
  return getOrgRoute(new Request(`http://localhost/api/admin/organizations/${id}`), {
    params: Promise.resolve({ id }),
  });
}

function remove(id: string, userId: string): Promise<Response> {
  return removeUserRoute(
    new Request(`http://localhost/api/admin/organizations/${id}/users/${userId}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ id, userId }) }
  );
}

beforeEach(() => {
  requireSuperAdminMock.mockReset().mockResolvedValue(OPERATOR);
  getOrganizationMock.mockReset();
  removeUserMock.mockReset();
});

describe("GET /api/admin/organizations/[id]", () => {
  it("existe → 200 con la empresa", async () => {
    getOrganizationMock.mockResolvedValue({ id: "org_a", name: "A", members: [] });
    const res = await getOrg("org_a");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { organization: { id: string } }).organization.id).toBe(
      "org_a"
    );
    expect(getOrganizationMock).toHaveBeenCalledWith("org_a");
  });

  it("no existe → 404 not_found", async () => {
    getOrganizationMock.mockResolvedValue(null);
    const res = await getOrg("org_nope");
    expect(res.status).toBe(404);
  });

  it("sin sesión → 401; sin rol de plataforma → 403", async () => {
    requireSuperAdminMock.mockRejectedValueOnce(new UnauthorizedError());
    expect((await getOrg("org_a")).status).toBe(401);
    requireSuperAdminMock.mockRejectedValueOnce(new ForbiddenError());
    expect((await getOrg("org_a")).status).toBe(403);
    expect(getOrganizationMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/organizations/[id]/users/[userId]", () => {
  it("ok → 200 con accountDeleted y el operador es el email de la sesión", async () => {
    removeUserMock.mockResolvedValue({ ok: true, accountDeleted: true });
    const res = await remove("org_a", "u_1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, accountDeleted: true });
    expect(removeUserMock).toHaveBeenCalledWith({
      organizationId: "org_a",
      userId: "u_1",
      operatorEmail: "superadmin@vocero.test",
    });
  });

  it.each([
    ["last_owner", 409],
    ["forbidden", 403],
    ["not_found", 404],
    ["not_member", 404],
  ])("%s → %i", async (code, status) => {
    removeUserMock.mockResolvedValue({ ok: false, code, message: "x" });
    const res = await remove("org_a", "u_1");
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
  });

  it("sin rol de plataforma → 403 y no toca nada", async () => {
    requireSuperAdminMock.mockRejectedValue(new ForbiddenError());
    expect((await remove("org_a", "u_1")).status).toBe(403);
    expect(removeUserMock).not.toHaveBeenCalled();
  });
});
