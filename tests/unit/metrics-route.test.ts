import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/metrics` (024): solo el propietario (403 `forbidden` para un
 * miembro, aunque sea una lectura), 400 con un rango desconocido y la
 * empresa SIEMPRE de la sesión.
 */

const requireSessionMock = vi.fn();
const overviewMock = vi.fn();

vi.mock("@/lib/auth/session", () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  class PasswordChangeRequiredError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    PasswordChangeRequiredError,
    requireSession: (...args: unknown[]) => requireSessionMock(...args),
    requireSuperAdmin: () => Promise.reject(new Error("no usado aquí")),
    getSessionOrNull: () => Promise.resolve(null),
  };
});

vi.mock("@/server/metrics/overview", () => ({
  getMetricsOverview: (...args: unknown[]) => overviewMock(...args),
}));

import { UnauthorizedError } from "@/lib/auth/session";
import { GET } from "@/app/api/metrics/route";

const OWNER = {
  userId: "u_1",
  email: "dueno@vocero.test",
  organizationId: "org_a",
  role: "owner",
  sessionId: "ses_1",
};

function get(qs: string): Request {
  return new Request(`http://localhost/api/metrics${qs}`);
}

beforeEach(() => {
  requireSessionMock.mockReset().mockResolvedValue(OWNER);
  overviewMock.mockReset().mockResolvedValue({ range: "day", series: [] });
});

describe("GET /api/metrics", () => {
  it("propietario → 200 con la empresa de la sesión, el rango y la zona", async () => {
    const res = await GET(get("?range=week&tz=America%2FArgentina%2FCordoba&organizationId=org_x"));
    expect(res.status).toBe(200);
    expect(overviewMock).toHaveBeenCalledWith("org_a", "week", "America/Argentina/Cordoba");
  });

  it("sin rango → diario; zona inválida → Buenos Aires", async () => {
    await GET(get("?tz=nada"));
    expect(overviewMock).toHaveBeenCalledWith("org_a", "day", "America/Argentina/Buenos_Aires");
  });

  it("miembro → 403 forbidden y no consulta nada", async () => {
    requireSessionMock.mockResolvedValue({ ...OWNER, role: "member" });
    const res = await GET(get("?range=day"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("forbidden");
    expect(overviewMock).not.toHaveBeenCalled();
  });

  it("sin sesión → 401", async () => {
    requireSessionMock.mockRejectedValue(new UnauthorizedError());
    const res = await GET(get(""));
    expect(res.status).toBe(401);
  });

  it("rango desconocido → 400 invalid_range", async () => {
    const res = await GET(get("?range=month"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_range");
    expect(overviewMock).not.toHaveBeenCalled();
  });
});
