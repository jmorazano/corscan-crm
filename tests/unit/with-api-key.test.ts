import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 014 (FR-009): withApiKey resuelve la empresa desde el Bearer, niega con
 * 401 `invalid_api_key` (mismo código para ausente/inválida/revocada) y
 * limita a 60/min por clave con 429 `rate_limited`.
 */

const verifyMock = vi.fn();
const touchMock = vi.fn(() => Promise.resolve());

vi.mock("@/server/api-keys/keys", () => ({
  verifyApiKey: (secret: string) => verifyMock(secret),
  touchApiKey: () => touchMock(),
}));

vi.mock("@/lib/db", () => ({ getDb: () => ({}), schema: {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: async () => null } }) }));

import { withApiKey } from "@/lib/api";
import { resetRateLimit } from "@/lib/rate-limit";
import { generateApiKey } from "@/lib/api-keys";

const VALID = generateApiKey();

beforeEach(() => {
  resetRateLimit();
  verifyMock.mockReset();
  touchMock.mockClear();
});
afterEach(() => vi.restoreAllMocks());

function req(auth?: string): Request {
  return new Request("http://localhost/api/v1/templates", {
    headers: auth ? { authorization: auth } : {},
  });
}

describe("withApiKey", () => {
  it("sin header → 401 sin consultar la BD", async () => {
    const inner = vi.fn(async () => Response.json({ ok: true }));
    const res = await withApiKey(inner)(req());
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_api_key");
    expect(verifyMock).not.toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
  });

  it("formato inválido → 401 sin consultar la BD", async () => {
    const res = await withApiKey(async () => Response.json({}))(req("Bearer vk_corta"));
    expect(res.status).toBe(401);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("clave desconocida o revocada → 401 (mismo código)", async () => {
    verifyMock.mockResolvedValue(null);
    const res = await withApiKey(async () => Response.json({}))(req(`Bearer ${VALID}`));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("invalid_api_key");
    expect(verifyMock).toHaveBeenCalledWith(VALID);
  });

  it("clave válida → contexto de la empresa y toque de último uso", async () => {
    verifyMock.mockResolvedValue({
      id: "ak_1",
      organizationId: "org_1",
      name: "Reservas",
      lastUsedAt: null,
    });
    const inner = vi.fn(async (ctx: unknown) => Response.json(ctx));
    const res = await withApiKey(inner)(req(`bearer ${VALID}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      organizationId: "org_1",
      apiKeyId: "ak_1",
      apiKeyName: "Reservas",
    });
    expect(touchMock).toHaveBeenCalledTimes(1);
  });

  it("más de 60 llamadas por minuto → 429 rate_limited", async () => {
    verifyMock.mockResolvedValue({
      id: "ak_rl",
      organizationId: "org_1",
      name: "Reservas",
      lastUsedAt: new Date(),
    });
    const handler = withApiKey(async () => Response.json({ ok: true }));
    for (let i = 0; i < 60; i++) {
      expect((await handler(req(`Bearer ${VALID}`))).status).toBe(200);
    }
    const res = await handler(req(`Bearer ${VALID}`));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.retryInSeconds).toBe(60);
  });

  it("error no controlado del handler → 500 sin stack", async () => {
    verifyMock.mockResolvedValue({ id: "ak_1", organizationId: "org_1", name: "R", lastUsedAt: null });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await withApiKey(async () => {
      throw new Error("boom");
    })(req(`Bearer ${VALID}`));
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("internal");
  });
});
