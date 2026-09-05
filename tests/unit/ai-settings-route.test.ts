import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato ai-settings.md: GET para cualquier miembro (last4, jamás el token
 * completo), PUT/DELETE solo owner, token vacío → 422, DELETE idempotente.
 */

const state = vi.hoisted(() => ({
  role: "owner" as string,
  saved: [] as Record<string, unknown>[],
  deleted: [] as string[],
  settings: null as Record<string, unknown> | null,
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
        email: "duena@empresa.com",
        organizationId: "org_1",
        role: state.role,
      }),
    requireSuperAdmin: () => Promise.reject(new Error("no usado aquí")),
    requireSessionUser: () => Promise.reject(new Error("no usado aquí")),
    getSessionOrNull: () => Promise.resolve(null),
  };
});

vi.mock("@/server/ai/credentials", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/ai/credentials")>();
  return {
    ...actual,
    getAiSettings: (organizationId: string) => {
      expect(organizationId).toBe("org_1");
      return Promise.resolve(state.settings);
    },
    saveAiConfig: (input: Record<string, unknown>) => {
      state.saved.push(input);
      return Promise.resolve();
    },
    deleteAiConfig: (organizationId: string) => {
      state.deleted.push(organizationId);
      return Promise.resolve();
    },
  };
});

import { DELETE, GET, PUT } from "@/app/api/settings/ai/route";
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_JUDGE_MODEL,
} from "@/server/ai/credentials";

function put(body: unknown): Promise<Response> {
  return PUT(
    new Request("http://localhost/api/settings/ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  state.role = "owner";
  state.saved.length = 0;
  state.deleted.length = 0;
  state.settings = null;
});

describe("GET /api/settings/ai", () => {
  it("sin config → config null + defaults de producto (guía para la UI)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.config).toBeNull();
    expect(body.defaults).toEqual({
      model: DEFAULT_AGENT_MODEL,
      judgeModel: DEFAULT_JUDGE_MODEL,
    });
  });

  it("con config → last4 y modelos; el token completo JAMÁS viaja; sirve a un member", async () => {
    state.role = "member";
    state.settings = { tokenLast4: "abcd", model: null, judgeModel: null };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      config: { configured: boolean; tokenLast4: string };
    };
    expect(body.config.configured).toBe(true);
    expect(body.config.tokenLast4).toBe("abcd");
    expect(JSON.stringify(body)).not.toContain("token-completo");
  });
});

describe("PUT /api/settings/ai", () => {
  it("guarda y responde tokenLast4", async () => {
    const res = await put({ token: "sk-or-token-nuevo-wxyz", model: "a/b" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tokenLast4: string };
    expect(body).toEqual({ ok: true, tokenLast4: "wxyz" });
    expect(state.saved[0]).toMatchObject({
      organizationId: "org_1",
      token: "sk-or-token-nuevo-wxyz",
      model: "a/b",
      judgeModel: null,
    });
  });

  it("token vacío → 422 sin guardar", async () => {
    const res = await put({ token: "   " });
    expect(res.status).toBe(422);
    expect(state.saved).toHaveLength(0);
  });

  it("member (no owner) → 403 forbidden sin guardar", async () => {
    state.role = "member";
    const res = await put({ token: "sk-or-token" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
    expect(state.saved).toHaveLength(0);
  });
});

describe("DELETE /api/settings/ai", () => {
  it("owner borra → { ok: true } e idempotente (200 repetido sin config)", async () => {
    const res1 = await DELETE();
    expect(res1.status).toBe(200);
    expect((await res1.json()) as unknown).toEqual({ ok: true });
    // segunda vez, ya sin config: sigue siendo 200 (contrato)
    const res2 = await DELETE();
    expect(res2.status).toBe(200);
    expect(state.deleted).toEqual(["org_1", "org_1"]);
  });

  it("member (no owner) → 403 sin borrar", async () => {
    state.role = "member";
    const res = await DELETE();
    expect(res.status).toBe(403);
    expect(state.deleted).toHaveLength(0);
  });
});
