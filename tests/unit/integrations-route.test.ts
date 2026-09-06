import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato integrations-api.md / FR-002: GET para cualquier miembro;
 * PUT/DELETE/connect solo `owner`; sin credenciales de instancia la
 * conexión no se ofrece (409) y el índice lo refleja (available=false).
 */

const state = vi.hoisted(() => ({
  role: "owner" as string,
  view: null as Record<string, unknown> | null,
  updated: [] as Record<string, unknown>[],
  disconnected: [] as string[],
}));

vi.mock("@/lib/auth/session", () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  class PasswordChangeRequiredError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    PasswordChangeRequiredError,
    requireSession: () =>
      Promise.resolve({ userId: "u_1", email: "duena@empresa.com", organizationId: "org_1", role: state.role }),
    requireSuperAdmin: () => Promise.reject(new Error("no usado aquí")),
    requireSessionUser: () => Promise.reject(new Error("no usado aquí")),
    getSessionOrNull: () => Promise.resolve(null),
  };
});

vi.mock("@/server/calendar/integration", () => ({
  getCalendarIntegrationView: (org: string) => {
    expect(org).toBe("org_1");
    return Promise.resolve(state.view);
  },
  updateCalendarIntegration: (org: string, patch: Record<string, unknown>) => {
    state.updated.push({ org, ...patch });
    return Promise.resolve(state.view !== null);
  },
  disconnectCalendarIntegration: (org: string) => {
    state.disconnected.push(org);
    return Promise.resolve();
  },
  listCalendars: () => Promise.resolve([{ id: "cal_2", summary: "Turnos", primary: false }]),
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

beforeEach(() => {
  state.role = "owner";
  state.view = null;
  state.updated.length = 0;
  state.disconnected.length = 0;
});

function put(body: unknown): Promise<Response> {
  return import("@/app/api/integrations/google-calendar/route").then(({ PUT }) =>
    PUT(
      new Request("http://localhost/api/integrations/google-calendar", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    )
  );
}

describe("GET /api/integrations", () => {
  it("instancia sin credenciales de Google → available=false, no conectada", async () => {
    const { GET } = await import("@/app/api/integrations/route");
    const res = await GET();
    const json = (await res.json()) as { integrations: Record<string, unknown>[] };
    expect(json.integrations[0]).toMatchObject({
      key: "google_calendar",
      available: false,
      connected: false,
      status: null,
    });
  });
});

describe("GET /api/integrations/google-calendar", () => {
  it("miembro puede ver pero canManage=false", async () => {
    state.role = "member";
    state.view = { accountEmail: "a@b.c", status: "connected" };
    const { GET } = await import("@/app/api/integrations/google-calendar/route");
    const json = (await (await GET()).json()) as Record<string, unknown>;
    expect(json.canManage).toBe(false);
    expect(json.integration).toMatchObject({ accountEmail: "a@b.c" });
  });
});

describe("PUT / DELETE / connect solo owner", () => {
  it("member → 403 forbidden en PUT y DELETE; nada se toca", async () => {
    state.role = "member";
    state.view = { status: "connected" };
    expect((await put({ slotMinutes: 45 })).status).toBe(403);
    const { DELETE } = await import("@/app/api/integrations/google-calendar/route");
    expect((await DELETE()).status).toBe(403);
    expect(state.updated).toEqual([]);
    expect(state.disconnected).toEqual([]);
  });

  it("owner: reglas inválidas → 422 con motivo; válidas → 200 y patch normalizado", async () => {
    state.view = { status: "connected" };
    const bad = await put({ horizonDays: 500 });
    expect(bad.status).toBe(422);
    const ok = await put({ weeklyHours: { "1": [["09:00", "12:00"]] }, slotMinutes: 45 });
    expect(ok.status).toBe(200);
    expect(state.updated[0]).toMatchObject({ org: "org_1", slotMinutes: 45 });
    expect((state.updated[0]!.weeklyHours as Record<string, unknown>)["0"]).toEqual([]);
  });

  it("owner: calendario elegido se resuelve contra la lista real (inexistente → 422)", async () => {
    state.view = { status: "connected" };
    expect((await put({ calendarId: "no_existe" })).status).toBe(422);
    expect((await put({ calendarId: "cal_2" })).status).toBe(200);
    expect(state.updated[0]).toMatchObject({ calendarId: "cal_2", calendarName: "Turnos" });
  });

  it("owner sin integración → PUT 404 not_connected; DELETE idempotente 200", async () => {
    expect((await put({ slotMinutes: 30 })).status).toBe(404);
    const { DELETE } = await import("@/app/api/integrations/google-calendar/route");
    expect((await DELETE()).status).toBe(200);
    expect(state.disconnected).toEqual(["org_1"]);
  });

  it("connect: member → 403; owner sin credenciales de instancia → 409 not_available", async () => {
    const { GET } = await import("@/app/api/integrations/google-calendar/connect/route");
    state.role = "member";
    expect((await GET()).status).toBe(403);
    state.role = "owner";
    const res = await GET();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_available");
  });
});
