import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";

/**
 * FR-004 / research D9: tokens de Google cifrados en reposo (la fila jamás
 * contiene el texto plano), todo acceso scoped por organización, caché del
 * access token y `invalid_grant` → reconnect_required.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  inserted: [] as Row[],
  updates: [] as { set: Row; sql: string; params: unknown[] }[],
  deletes: [] as { sql: string; params: unknown[] }[],
  wheres: [] as { sql: string; params: unknown[] }[],
  refreshCalls: 0,
  refreshThrows: null as Error | null,
  revoked: [] as string[],
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const render = (cond: unknown) => new PgDialect().sqlToQuery(cond as SQL);
  const matching = (q: { params: unknown[] }) =>
    state.rows.filter((r) => q.params.includes(r.organizationId) || q.params.includes(r.id));
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: (cond: unknown) => {
            const q = render(cond);
            state.wheres.push({ sql: q.sql, params: q.params });
            return { limit: () => Promise.resolve(matching(q)) };
          },
        }),
      }),
      insert: () => ({
        values: (v: Row) => {
          state.inserted.push(v);
          return { onConflictDoUpdate: () => Promise.resolve() };
        },
      }),
      update: () => ({
        set: (set: Row) => ({
          where: (cond: unknown) => {
            const q = render(cond);
            state.updates.push({ set, sql: q.sql, params: q.params });
            for (const r of matching(q)) Object.assign(r, set);
            const p = Promise.resolve();
            return Object.assign(p, { returning: () => Promise.resolve(matching(q)) });
          },
        }),
      }),
      delete: () => ({
        where: (cond: unknown) => {
          const q = render(cond);
          state.deletes.push({ sql: q.sql, params: q.params });
          return Promise.resolve();
        },
      }),
    }),
  };
});

vi.mock("@/lib/google/oauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google/oauth")>();
  return {
    ...actual,
    refreshAccessToken: () => {
      state.refreshCalls += 1;
      if (state.refreshThrows) return Promise.reject(state.refreshThrows);
      return Promise.resolve({ accessToken: "ya29.renovado", expiresAt: new Date(Date.now() + 3600_000) });
    },
    revokeToken: (t: string) => {
      state.revoked.push(t);
      return Promise.resolve();
    },
  };
});

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

beforeEach(() => {
  state.rows.length = 0;
  state.inserted.length = 0;
  state.updates.length = 0;
  state.deletes.length = 0;
  state.wheres.length = 0;
  state.refreshCalls = 0;
  state.refreshThrows = null;
  state.revoked.length = 0;
});

async function seed(organizationId: string, opts: { accessFresh?: boolean; status?: string } = {}) {
  const { encryptSecret } = await import("@/lib/crypto");
  const { DEFAULT_WEEKLY_HOURS } = await import("@/server/calendar/rules");
  const refresh = encryptSecret(`refresh-de-${organizationId}`);
  const access = encryptSecret(`access-de-${organizationId}`);
  state.rows.push({
    id: `cint_${organizationId}`,
    organizationId,
    provider: "google",
    accountEmail: `${organizationId}@negocio.test`,
    calendarId: "primary",
    calendarName: null,
    timezone: "America/Argentina/Buenos_Aires",
    refreshTokenCipher: refresh.cipher,
    refreshTokenIv: refresh.iv,
    refreshTokenTag: refresh.tag,
    accessTokenCipher: access.cipher,
    accessTokenIv: access.iv,
    accessTokenTag: access.tag,
    accessTokenExpiresAt: new Date(Date.now() + (opts.accessFresh === false ? -1000 : 3600_000)),
    status: opts.status ?? "connected",
    agentBookingEnabled: true,
    slotMinutes: 30,
    bufferMinutes: 0,
    minLeadHours: 2,
    horizonDays: 14,
    weeklyHours: DEFAULT_WEEKLY_HOURS,
    bookingInstructions: null,
    connectedBy: "u_1",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("integración de calendario por empresa", () => {
  it("connect cifra refresh y access token: la fila no contiene texto plano", async () => {
    const { connectCalendarIntegration } = await import("@/server/calendar/integration");
    await connectCalendarIntegration({
      organizationId: "org_1",
      userId: "u_1",
      tokens: {
        accessToken: "ya29.acceso-secreto",
        refreshToken: "1//refresh-secreto",
        expiresAt: new Date(Date.now() + 3600_000),
        email: "agenda@negocio.test",
      },
    });
    const row = state.inserted[0]!;
    const json = JSON.stringify(row);
    expect(json).not.toContain("acceso-secreto");
    expect(json).not.toContain("refresh-secreto");
    expect(row.accountEmail).toBe("agenda@negocio.test");
    expect(String(row.id)).toMatch(/^cint_/);
    const { decryptSecret } = await import("@/lib/crypto");
    expect(
      decryptSecret({
        cipher: row.refreshTokenCipher as string,
        iv: row.refreshTokenIv as string,
        tag: row.refreshTokenTag as string,
      })
    ).toBe("1//refresh-secreto");
  });

  it("connect sin refresh token → error tipado (no hay conexión durable)", async () => {
    const { connectCalendarIntegration } = await import("@/server/calendar/integration");
    await expect(
      connectCalendarIntegration({
        organizationId: "org_1",
        userId: "u_1",
        tokens: { accessToken: "a", refreshToken: null, expiresAt: new Date(), email: null },
      })
    ).rejects.toThrow(/refresh token/);
    expect(state.inserted).toEqual([]);
  });

  it("la vista para la UI expone cuenta, calendario y reglas — jamás tokens", async () => {
    const { getCalendarIntegrationView } = await import("@/server/calendar/integration");
    await seed("org_1");
    const view = await getCalendarIntegrationView("org_1");
    expect(view).toMatchObject({ accountEmail: "org_1@negocio.test", status: "connected", slotMinutes: 30 });
    expect(JSON.stringify(view)).not.toMatch(/refresh|access|cipher/i);
    expect(state.wheres[0]!.sql).toContain("organization_id");
    expect(state.wheres[0]!.params).toEqual(["org_1"]);
  });

  it("scoping: org_a no ve la integración de org_b", async () => {
    const { getCalendarIntegration } = await import("@/server/calendar/integration");
    await seed("org_a");
    await seed("org_b");
    expect((await getCalendarIntegration("org_a"))?.accountEmail).toBe("org_a@negocio.test");
    expect(await getCalendarIntegration("org_c")).toBeNull();
    await expect(getCalendarIntegration("")).rejects.toThrow(/organizationId vacío/);
  });

  it("ensureAccessToken usa la caché si está fresca y renueva si venció", async () => {
    const { ensureAccessToken } = await import("@/server/calendar/integration");
    await seed("org_1", { accessFresh: true });
    expect(await ensureAccessToken("org_1")).toBe("access-de-org_1");
    expect(state.refreshCalls).toBe(0);

    state.rows.length = 0;
    await seed("org_1", { accessFresh: false });
    expect(await ensureAccessToken("org_1")).toBe("ya29.renovado");
    expect(state.refreshCalls).toBe(1);
    // Persistió el nuevo access token cifrado (jamás en claro).
    const persisted = state.updates.at(-1)!;
    expect(JSON.stringify(persisted.set)).not.toContain("ya29.renovado");
    expect(persisted.set.accessTokenCipher).toBeTruthy();
  });

  it("invalid_grant al renovar → status reconnect_required y error relanzado", async () => {
    const { ensureAccessToken } = await import("@/server/calendar/integration");
    const { GoogleAuthError } = await import("@/lib/google/oauth");
    await seed("org_1", { accessFresh: false });
    state.refreshThrows = new GoogleAuthError("invalid_grant", "revocado");
    await expect(ensureAccessToken("org_1")).rejects.toMatchObject({ code: "invalid_grant" });
    const mark = state.updates.find((u) => u.set.status === "reconnect_required");
    expect(mark).toBeTruthy();
    expect(mark!.sql).toContain("organization_id");
    expect(mark!.params).toEqual(["org_1"]);
    // Con la fila marcada, no se vuelve a intentar contra Google.
    await expect(ensureAccessToken("org_1")).rejects.toMatchObject({ code: "invalid_grant" });
    expect(state.refreshCalls).toBe(1);
  });

  it("disconnect revoca el refresh token y borra la fila scoped; idempotente", async () => {
    const { disconnectCalendarIntegration } = await import("@/server/calendar/integration");
    await seed("org_1");
    await disconnectCalendarIntegration("org_1");
    expect(state.revoked).toEqual(["refresh-de-org_1"]);
    expect(state.deletes[0]!.sql).toContain("organization_id");
    expect(state.deletes[0]!.params).toEqual(["org_1"]);
    await disconnectCalendarIntegration("org_sin");
    expect(state.deletes.length).toBe(1);
  });
});
