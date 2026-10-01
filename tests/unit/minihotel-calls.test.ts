import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";

/**
 * 028 — MiniHotel por la MISMA puerta única (`callGuarded`): despacho por
 * transporte, credencial `{usuario, contraseña}`, config del proveedor,
 * motivo de reconexión y la verificación que trae el catálogo SIN caché.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => {
  // El esquema de env valida todo junto la primera vez que alguien cifra.
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
  return {
    rows: [] as Row[],
    inserted: [] as Row[],
    updates: [] as { set: Row }[],
    calls: [] as { cfg: Record<string, unknown>; tool: string; args: Record<string, unknown> }[],
    next: null as unknown,
    throws: null as Error | null,
  };
});

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
            const rows = matching(render(cond));
            return {
              limit: () => Promise.resolve(rows),
              orderBy: () => ({ limit: () => Promise.resolve(rows) }),
            };
          },
          innerJoin: () => ({ where: () => Promise.resolve([]) }),
        }),
      }),
      insert: () => ({
        values: (v: Row) => {
          state.inserted.push(v);
          return Object.assign(Promise.resolve(), { onConflictDoUpdate: () => Promise.resolve() });
        },
      }),
      update: () => ({
        set: (set: Row) => ({
          where: (cond: unknown) => {
            const q = render(cond);
            state.updates.push({ set });
            for (const r of matching(q)) Object.assign(r, set);
            return Object.assign(Promise.resolve(), { returning: () => Promise.resolve(matching(q)) });
          },
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
    }),
  };
});

vi.mock("@/lib/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp")>();
  // Sin DNS real en los tests.
  return { ...actual, assertResolvable: async () => undefined };
});

vi.mock("@/lib/minihotel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/minihotel")>();
  return {
    ...actual,
    miniHotelCallTool: async (cfg: Record<string, unknown>, tool: string, args: Record<string, unknown>) => {
      state.calls.push({ cfg, tool, args });
      if (state.throws) throw state.throws;
      return { outcome: { ok: true, data: state.next }, raw: null, httpStatus: 200, bytes: 512 };
    },
  };
});

const { callGuarded, handshakeGuarded, resetMcpCallCache } = await import("@/server/mcp/calls");
const { McpError, mcpErrorText } = await import("@/lib/mcp");
const { encryptSecret } = await import("@/lib/crypto");
const { serializeMiniHotelCredential } = await import("@/lib/minihotel");
const { resetRateLimit } = await import("@/lib/rate-limit");
const { minihotel } = await import("@/server/mcp/profiles");
import type { McpIntegration } from "@/server/mcp/integration";

const CONFIG = {
  hotelId: "sandbox",
  rateCode: "USD",
  bookingEngineUrl:
    "https://sandbox.minihotel.cloud/BookingFrameClient/hotel/B263C4CD7A30D45315E78416F6F4F942/153f2c6a-a062-4c7b-97d7-c6bb89533ae6/book/rooms",
  showPrices: true,
  showNonRefundable: false,
};
const SECRET = serializeMiniHotelCredential({ username: "Test", password: "3657488" });

function integration(overrides: Partial<McpIntegration> = {}): McpIntegration {
  return {
    id: "mint_mh",
    organizationId: "org_mh",
    profileKey: "minihotel",
    profile: minihotel,
    label: "Bosque Douglas (hotel)",
    endpointUrl: "https://sandbox.minihotel.cloud/gds",
    endpointHost: "sandbox.minihotel.cloud",
    authScheme: "bearer",
    status: "connected",
    sessionMode: "stateless",
    timezone: "America/Argentina/Cordoba",
    timeoutMs: 10_000,
    maxResponseBytes: 524_288,
    agentToolsEnabled: true,
    instructions: null,
    useServerInstructions: false,
    catalog: null,
    catalogFetchedAt: null,
    catalogTtlMinutes: 60,
    providerConfig: CONFIG,
    hasCredential: true,
    resolveCredential: () => SECRET,
    ...overrides,
  };
}

function dbRow(overrides: Row = {}): Row {
  return {
    id: "mint_mh",
    organizationId: "org_mh",
    profile: "minihotel",
    label: "Bosque Douglas (hotel)",
    endpointUrl: "https://sandbox.minihotel.cloud/gds",
    authScheme: "bearer",
    credential: encryptSecret(SECRET),
    credentialLast4: "7488",
    status: "enabled",
    sessionMode: "stateless",
    serverName: null,
    serverVersion: null,
    protocolVersion: null,
    instructions: null,
    useServerInstructions: false,
    tools: null,
    lastHandshakeAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    providerConfig: CONFIG,
    catalog: null,
    catalogFetchedAt: null,
    catalogTtlMinutes: 60,
    timezone: "America/Argentina/Cordoba",
    agentToolsEnabled: true,
    timeoutMs: 10_000,
    maxResponseBytes: 524_288,
    enabledBy: "usr_admin",
    enabledAt: new Date("2026-10-01T12:00:00Z"),
    connectedBy: null,
    connectedAt: null,
    ...overrides,
  };
}

const AVAIL_ARGS = { ranges: [{ from: "2026-11-10", to: "2026-11-12" }], adults: 2, children: 0, babies: 0, alternatives: true };
const CATALOG_DATA = {
  roomTypes: [{ code: "DBL", description: "Habitación doble", image: null }],
  rooms: [{ number: "1", type: "DBL", mapped: true, maxAdults: 2, maxChildren: 1, maxBabies: 1, attributes: [] }],
};

beforeEach(() => {
  state.rows = [];
  state.inserted = [];
  state.updates = [];
  state.calls = [];
  state.next = { ranges: [] };
  state.throws = null;
  resetMcpCallCache();
  resetRateLimit();
});

describe("callGuarded con transporte MiniHotel", () => {
  it("despacha al cliente XML con usuario/contraseña, hotel, tarifa y la fecha local", async () => {
    const out = await callGuarded({
      integration: integration(),
      tool: "availability",
      args: AVAIL_ARGS,
      conversationId: "cv_1",
      sandbox: false,
    });
    expect(out.ok).toBe(true);
    expect(state.calls).toHaveLength(1);
    const { cfg, tool } = state.calls[0]!;
    expect(tool).toBe("availability");
    expect(cfg).toMatchObject({
      ariEndpoint: "https://sandbox.minihotel.cloud/gds",
      username: "Test",
      password: "3657488",
      hotelId: "sandbox",
      rateCode: "USD",
      sandbox: false,
    });
    expect(cfg.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // La bitácora guarda NUESTROS argumentos, jamás la credencial.
    expect(JSON.stringify(state.inserted)).not.toContain("3657488");
  });

  it("herramienta fuera de la allowlist del perfil: ni siquiera sale", async () => {
    const out = await callGuarded({
      integration: integration(),
      tool: "create_booking",
      args: {},
      conversationId: null,
      sandbox: false,
    });
    expect(out).toMatchObject({ ok: false, code: "not_allowed" });
    expect(state.calls).toHaveLength(0);
  });

  it("Laboratorio: datos de ejemplo del perfil, sin red", async () => {
    const out = await callGuarded({
      integration: integration(),
      tool: "availability",
      args: AVAIL_ARGS,
      conversationId: "cv_lab",
      sandbox: true,
      action: { action: "search_stays", check_in: "2026-11-10", check_out: "2026-11-12", adults: 2 },
    });
    expect(out).toMatchObject({ ok: true, sandbox: true });
    expect(state.calls).toHaveLength(0);
    expect(state.inserted[0]).toMatchObject({ isTest: true });
  });

  it("IP no autorizada → «Requiere reconexión» con el MOTIVO, y su texto propio", async () => {
    state.rows = [dbRow({ status: "connected" })];
    state.throws = new McpError("unauthorized", { providerCode: "ip_not_authorized" });
    const out = await callGuarded({
      integration: integration(),
      tool: "availability",
      args: AVAIL_ARGS,
      conversationId: null,
      sandbox: false,
    });
    expect(out).toMatchObject({ ok: false, code: "unauthorized" });
    expect(state.rows[0]).toMatchObject({ status: "reconnect_required", lastErrorCode: "ip_not_authorized" });
    expect(mcpErrorText("ip_not_authorized")).toContain("autorizó la IP");
  });

  it("credencial guardada que no es {usuario, contraseña} ⇒ unauthorized por `auth`", async () => {
    state.rows = [dbRow({ status: "connected" })];
    const out = await callGuarded({
      integration: integration({ resolveCredential: () => "token-plano-de-otro-perfil" }),
      tool: "availability",
      args: AVAIL_ARGS,
      conversationId: null,
      sandbox: false,
    });
    expect(out).toMatchObject({ ok: false, code: "unauthorized" });
    expect(state.rows[0]).toMatchObject({ lastErrorCode: "auth" });
    expect(state.calls).toHaveLength(0);
  });

  it("sin config del proveedor (hotel/tarifa) ⇒ not_allowed, sin red", async () => {
    const out = await callGuarded({
      integration: integration({ providerConfig: { showPrices: true } }),
      tool: "availability",
      args: AVAIL_ARGS,
      conversationId: null,
      sandbox: false,
    });
    expect(out).toMatchObject({ ok: false, code: "not_allowed" });
    expect(state.calls).toHaveLength(0);
  });
});

describe("handshakeGuarded para MiniHotel = catálogo de habitaciones", () => {
  it("prueba la credencial, guarda el catálogo y queda Conectado", async () => {
    state.rows = [dbRow()];
    state.next = CATALOG_DATA;
    const out = await handshakeGuarded("org_mh");
    expect(out.ok).toBe(true);
    expect(state.calls.map((c) => c.tool)).toEqual(["room_catalog"]);
    expect(state.rows[0]).toMatchObject({ status: "connected", serverName: "MiniHotel (hotel)" });
    const saved = state.rows[0]!.catalog as { roomTypes: Array<{ code: string; maxAdults: number }> };
    expect(saved.roomTypes[0]).toMatchObject({ code: "DBL", maxAdults: 2 });
    if (!out.ok) throw new Error("debía andar");
    expect(out.integration.providerSettings).toMatchObject({ hotelId: "sandbox", showPrices: true });
    expect(out.integration.catalog?.roomTypes[0]?.code).toBe("DBL");
  });

  it("SIN caché: verificar dos veces seguidas consulta dos veces (credencial recién cambiada)", async () => {
    state.rows = [dbRow()];
    state.next = CATALOG_DATA;
    await handshakeGuarded("org_mh");
    await handshakeGuarded("org_mh");
    expect(state.calls).toHaveLength(2);
  });

  it("desde «Requiere reconexión» igual se reintenta (verificar es el reintento)", async () => {
    state.rows = [dbRow({ status: "reconnect_required", lastErrorCode: "auth" })];
    state.next = CATALOG_DATA;
    const out = await handshakeGuarded("org_mh");
    expect(out.ok).toBe(true);
    expect(state.rows[0]).toMatchObject({ status: "connected", lastErrorCode: null });
  });

  it("sin hotel/tarifa ⇒ not_configured, sin red", async () => {
    state.rows = [dbRow({ providerConfig: null })];
    const out = await handshakeGuarded("org_mh");
    expect(out).toMatchObject({ ok: false, code: "not_configured" });
    expect(state.calls).toHaveLength(0);
  });

  it("credencial rechazada ⇒ unauthorized y la fila con el motivo", async () => {
    state.rows = [dbRow()];
    state.throws = new McpError("unauthorized", { providerCode: "auth" });
    const out = await handshakeGuarded("org_mh");
    expect(out).toMatchObject({ ok: false, code: "unauthorized" });
    expect(state.rows[0]).toMatchObject({ status: "reconnect_required", lastErrorCode: "auth" });
  });
});
