import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FR-016 + FR-017 sobre el POST de Equipo: los correos de SUPER_ADMIN_EMAILS
 * están reservados (403 reserved_email para operadores comunes), la alta
 * valida min 8 server-side y deja la cuenta con must_change_password.
 */

const sessionState: {
  current: { userId: string; email: string; organizationId: string; role: string };
} = {
  current: {
    userId: "u_owner",
    email: "owner@empresa.com",
    organizationId: "org_1",
    role: "owner",
  },
};

const signUpEmailMock = vi.fn();
const memberInserts: Record<string, unknown>[] = [];
const userUpdates: Record<string, unknown>[] = [];

vi.mock("@/lib/auth/session", () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireSession: () => Promise.resolve(sessionState.current),
    requireSuperAdmin: () => Promise.reject(new Error("no usado aquí")),
    getSessionOrNull: () => Promise.resolve(sessionState.current),
  };
});

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { signUpEmail: signUpEmailMock } }),
  runInternalSignup: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          memberInserts.push(v);
          return { onConflictDoNothing: () => Promise.resolve() };
        },
      }),
      update: () => ({
        set: (v: Record<string, unknown>) => {
          userUpdates.push(v);
          return { where: () => Promise.resolve() };
        },
      }),
    }),
  };
});

import { POST } from "@/app/api/settings/team/route";

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/settings/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  sessionState.current = {
    userId: "u_owner",
    email: "owner@empresa.com",
    organizationId: "org_1",
    role: "owner",
  };
  signUpEmailMock.mockReset();
  signUpEmailMock.mockResolvedValue({ user: { id: "u_nuevo" } });
  memberInserts.length = 0;
  userUpdates.length = 0;
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/settings/team", () => {
  it("email reservado + operador común → 403 reserved_email sin crear nada", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "duena@agencia.com");
    const res = await post({
      name: "Impostor",
      email: "duena@agencia.com",
      password: "temporal123",
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("reserved_email");
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(userUpdates).toHaveLength(0);
  });

  it("operador super admin sí puede usar un email reservado", async () => {
    vi.stubEnv(
      "SUPER_ADMIN_EMAILS",
      "duena@agencia.com,respaldo@agencia.com"
    );
    sessionState.current.email = "duena@agencia.com";
    const res = await post({
      name: "Respaldo",
      email: "respaldo@agencia.com",
      password: "temporal123",
    });
    expect(res.status).toBe(201);
    expect(signUpEmailMock).toHaveBeenCalledOnce();
  });

  it("alta feliz: membresía member + must_change_password activado (FR-017)", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "duena@agencia.com");
    const res = await post({
      name: "Compañera",
      email: "compa@empresa.com",
      password: "temporal123",
    });
    expect(res.status).toBe(201);
    expect(memberInserts[0]).toMatchObject({
      organizationId: "org_1",
      userId: "u_nuevo",
      role: "member",
    });
    expect(userUpdates[0]).toMatchObject({ mustChangePassword: true });
  });

  it("password de menos de 8 caracteres → 422 (Zod server-side)", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "duena@agencia.com");
    const res = await post({
      name: "Compañera",
      email: "compa@empresa.com",
      password: "corta12",
    });
    expect(res.status).toBe(422);
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("solo el owner puede crear cuentas", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "duena@agencia.com");
    sessionState.current.role = "member";
    const res = await post({
      name: "Compañera",
      email: "compa@empresa.com",
      password: "temporal123",
    });
    expect(res.status).toBe(403);
  });
});
