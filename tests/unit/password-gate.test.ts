import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FR-017 en la capa de sesión/API: una sesión con contraseña temporal
 * vigente (must_change_password) NO opera la API — el candado vive en
 * requireSession/withAuth, no solo en el shell de páginas. El shell usa
 * allowPendingPassword para poder redirigir a /change-password.
 */

let pendingFlag = false;

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: {
      getSession: async () => ({
        user: { id: "u_1", email: "socio@vocero.test" },
      }),
    },
  }),
}));

vi.mock("@/server/auth/on-signup", () => ({
  resolveMembership: async () => ({
    organizationId: "org_1",
    role: "owner",
  }),
}));

vi.mock("@/server/auth/super-admin", () => ({
  isSuperAdminEmail: () => false,
  isEmailReservedForOperator: () => false,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ pending: pendingFlag }]),
        }),
      }),
    }),
  }),
  schema: {
    user: { id: "user.id", mustChangePassword: "user.must_change_password" },
  },
}));

beforeEach(() => {
  vi.resetModules();
  pendingFlag = false;
});

describe("requireSession + must_change_password (FR-017)", () => {
  it("sin flag pendiente la sesión opera normal", async () => {
    const { requireSession } = await import("@/lib/auth/session");
    await expect(requireSession()).resolves.toMatchObject({
      userId: "u_1",
      organizationId: "org_1",
    });
  });

  it("con flag pendiente lanza PasswordChangeRequiredError", async () => {
    pendingFlag = true;
    const { requireSession, PasswordChangeRequiredError } = await import(
      "@/lib/auth/session"
    );
    await expect(requireSession()).rejects.toBeInstanceOf(
      PasswordChangeRequiredError
    );
  });

  it("allowPendingPassword tolera el flag (el shell redirige, no bloquea)", async () => {
    pendingFlag = true;
    const { requireSession } = await import("@/lib/auth/session");
    await expect(
      requireSession({ allowPendingPassword: true })
    ).resolves.toMatchObject({ userId: "u_1" });
  });

  it("withAuth mapea el candado a 403 password_change_required", async () => {
    pendingFlag = true;
    const { withAuth } = await import("@/lib/api");
    const handler = withAuth(async () => Response.json({ ok: true }));
    const res = await handler();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("password_change_required");
  });
});
