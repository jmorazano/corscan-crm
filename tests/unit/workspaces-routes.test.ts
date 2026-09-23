import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato specs/018-workspaces/contracts/api.md: `GET /api/workspaces`,
 * `POST /api/workspaces/switch` (200 / 403 not_member / 422) y el alta de
 * Administración con `attachExisting` (200 attached / 404 / 409 / 403) o
 * el 409 `duplicate_email` con `canAttach`.
 */

const requireSessionMock = vi.fn();
const requireSuperAdminMock = vi.fn();
const listWorkspacesMock = vi.fn();
const switchWorkspaceMock = vi.fn();
const createUserMock = vi.fn();
const attachMock = vi.fn();

vi.mock("@/lib/auth/session", () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  class PasswordChangeRequiredError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    PasswordChangeRequiredError,
    requireSession: (...args: unknown[]) => requireSessionMock(...args),
    requireSuperAdmin: (...args: unknown[]) => requireSuperAdminMock(...args),
    requireSessionUser: () => Promise.reject(new Error("no usado aquí")),
    getSessionOrNull: () => Promise.resolve(null),
  };
});

vi.mock("@/server/workspaces/list", () => ({
  listWorkspaces: (...args: unknown[]) => listWorkspacesMock(...args),
  listMembershipOrganizationIds: () => Promise.resolve([]),
}));
vi.mock("@/server/workspaces/switch", () => ({
  switchWorkspace: (...args: unknown[]) => switchWorkspaceMock(...args),
}));
vi.mock("@/server/admin/users", () => ({
  createOrganizationUser: (...args: unknown[]) => createUserMock(...args),
  resetUserPassword: () => Promise.reject(new Error("no usado aquí")),
}));
vi.mock("@/server/auth/membership", () => ({
  attachExistingUser: (...args: unknown[]) => attachMock(...args),
}));

import { UnauthorizedError } from "@/lib/auth/session";
import { GET as listRoute } from "@/app/api/workspaces/route";
import { POST as switchRoute } from "@/app/api/workspaces/switch/route";
import { POST as adminUsersRoute } from "@/app/api/admin/organizations/[id]/users/route";

const SESSION = {
  userId: "u_1",
  email: "op@vocero.test",
  organizationId: "org_a",
  role: "owner",
  sessionId: "ses_1",
};

function json(url: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireSessionMock.mockReset().mockResolvedValue(SESSION);
  requireSuperAdminMock
    .mockReset()
    .mockResolvedValue({ userId: "u_sa", email: "superadmin@vocero.test" });
  listWorkspacesMock.mockReset();
  switchWorkspaceMock.mockReset();
  createUserMock.mockReset();
  attachMock.mockReset();
});

describe("GET /api/workspaces", () => {
  it("devuelve la activa de la sesión y los espacios del usuario", async () => {
    listWorkspacesMock.mockResolvedValue([
      { id: "org_a", name: "A", slug: "a", role: "owner", accent: "#3f5972", unread: 0 },
      { id: "org_b", name: "B", slug: "b", role: "member", accent: "#3f6b66", unread: 5 },
    ]);
    const res = await listRoute();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { active: string; workspaces: unknown[] };
    expect(data.active).toBe("org_a");
    expect(data.workspaces).toHaveLength(2);
    expect(listWorkspacesMock).toHaveBeenCalledWith("u_1");
  });

  it("sin sesión → 401", async () => {
    requireSessionMock.mockRejectedValue(new UnauthorizedError());
    const res = await listRoute();
    expect(res.status).toBe(401);
  });
});

describe("POST /api/workspaces/switch", () => {
  it("miembro → 200 y usa la sesión ACTUAL", async () => {
    switchWorkspaceMock.mockResolvedValue({ ok: true, organizationId: "org_b" });
    const res = await switchRoute(json("/api/workspaces/switch", { organizationId: "org_b" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, organizationId: "org_b" });
    expect(switchWorkspaceMock).toHaveBeenCalledWith({
      userId: "u_1",
      sessionId: "ses_1",
      organizationId: "org_b",
    });
  });

  it("no miembro → 403 not_member", async () => {
    switchWorkspaceMock.mockResolvedValue({
      ok: false,
      code: "not_member",
      message: "No sos miembro de ese espacio de trabajo",
    });
    const res = await switchRoute(json("/api/workspaces/switch", { organizationId: "org_x" }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_member");
  });

  it("body inválido → 422", async () => {
    const res = await switchRoute(json("/api/workspaces/switch", { organizationId: "" }));
    expect(res.status).toBe(422);
    expect(switchWorkspaceMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/organizations/[id]/users (018)", () => {
  const ctx = { params: Promise.resolve({ id: "org_b" }) };

  it("attachExisting → 200 attached y NO pasa por el alta normal", async () => {
    attachMock.mockResolvedValue({ ok: true, userId: "u_op" });
    const res = await adminUsersRoute(
      json("/api/admin/organizations/org_b/users", {
        email: "op@vocero.test",
        role: "member",
        attachExisting: true,
      }),
      ctx
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, userId: "u_op", attached: true });
    expect(attachMock).toHaveBeenCalledWith({
      organizationId: "org_b",
      email: "op@vocero.test",
      role: "member",
    });
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it.each([
    ["already_member", 409],
    ["user_not_found", 404],
    ["not_found", 404],
    ["reserved_email", 403],
  ])("attach con %s → %i", async (code, status) => {
    attachMock.mockResolvedValue({ ok: false, code, message: "x" });
    const res = await adminUsersRoute(
      json("/api/admin/organizations/org_b/users", {
        email: "op@vocero.test",
        role: "member",
        attachExisting: true,
      }),
      ctx
    );
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
  });

  it("alta normal duplicada → 409 con canAttach", async () => {
    createUserMock.mockResolvedValue({
      ok: false,
      code: "duplicate_email",
      message: "Ya existe una cuenta con ese correo",
      canAttach: true,
    });
    const res = await adminUsersRoute(
      json("/api/admin/organizations/org_b/users", {
        name: "Op",
        email: "op@vocero.test",
        password: "temporal123",
        role: "member",
      }),
      ctx
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; canAttach: boolean } };
    expect(body.error).toMatchObject({ code: "duplicate_email", canAttach: true });
  });

  it("attach sin rol de plataforma → 403", async () => {
    const { ForbiddenError } = await import("@/lib/auth/session");
    requireSuperAdminMock.mockRejectedValue(new ForbiddenError());
    const res = await adminUsersRoute(
      json("/api/admin/organizations/org_b/users", {
        email: "op@vocero.test",
        role: "member",
        attachExisting: true,
      }),
      ctx
    );
    expect(res.status).toBe(403);
    expect(attachMock).not.toHaveBeenCalled();
  });
});
