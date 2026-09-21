import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";

/**
 * 016 — `callGuarded`, el único lugar del repo que llama a un MCP.
 *
 * Lo que se verifica acá es el ORDEN de los guardrails, que es donde vivía el
 * bug que encontró la revisión: allowlist del perfil → corte de sandbox (que
 * **escribe** la fila `is_test`) → credencial → cupo → caché → red → bitácora.
 * Y la regla de oro de FR-016: el `errorMessage` que se persiste sale
 * SIEMPRE de `MCP_ERROR_TEXT`, nunca de bytes del remoto.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  inserted: [] as Row[],
  updates: [] as { set: Row; sql: string; params: unknown[] }[],
  calls: [] as { tool: string; args: Record<string, unknown> }[],
  next: null as unknown,
  throws: null as Error | null,
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
            const rows = matching(q);
            const chain = {
              limit: () => Promise.resolve(rows),
              orderBy: () => ({ limit: () => Promise.resolve(rows) }),
            };
            return chain;
          },
          innerJoin: () => ({ where: () => Promise.resolve([]) }),
        }),
      }),
      insert: () => ({
        values: (v: Row) => {
          state.inserted.push(v);
          const p = Promise.resolve();
          return Object.assign(p, { onConflictDoUpdate: () => Promise.resolve() });
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
      delete: () => ({ where: () => Promise.resolve() }),
    }),
  };
});

vi.mock("@/lib/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp")>();
  return {
    ...actual,
    mcpCallTool: async (
      _cfg: unknown,
      tool: string,
      args: Record<string, unknown>
    ) => {
      state.calls.push({ tool, args });
      if (state.throws) throw state.throws;
      return {
        outcome: actual.unwrapToolResult({
          content: [{ type: "text", text: JSON.stringify(state.next ?? { success: true }) }],
        }),
        raw: null,
        httpStatus: 200,
        bytes: 128,
      };
    },
  };
});

const { callGuarded, handshakeGuarded, argsHash, resetMcpCallCache } = await import(
  "@/server/mcp/calls"
);
const { MCP_ERROR_TEXT, McpError } = await import("@/lib/mcp");
const { resetRateLimit } = await import("@/lib/rate-limit");
const { altos } = await import("@/server/mcp/profiles");
const { generic } = await import("@/server/mcp/profiles");
import type { McpIntegration } from "@/server/mcp/integration";

const CREDENTIAL = "token-secretisimo-del-pms";

function integration(overrides: Partial<McpIntegration> = {}): McpIntegration {
  return {
    id: "mint_1",
    organizationId: "org_1",
    profileKey: "altos_de_calamuchita",
    profile: altos,
    label: "Altos de Calamuchita (reservas)",
    endpointUrl: "https://altosdecalamuchita.com/mcp/assistant",
    endpointHost: "altosdecalamuchita.com",
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
    hasCredential: true,
    resolveCredential: () => CREDENTIAL,
    ...overrides,
  };
}

const SEARCH_ARGS = { check_in: "2026-10-01", check_out: "2026-10-03", guests: 4 };

function call(overrides: Partial<Parameters<typeof callGuarded>[0]> = {}) {
  return callGuarded({
    integration: integration(),
    tool: "check-availability",
    args: SEARCH_ARGS,
    conversationId: "cv_1",
    sandbox: false,
    ...overrides,
  });
}

beforeEach(() => {
  state.rows = [];
  state.inserted = [];
  state.updates = [];
  state.calls = [];
  state.next = { success: true, properties: [] };
  state.throws = null;
  resetMcpCallCache();
  resetRateLimit();
});

describe("allowlist del perfil (FR-007)", () => {
  it("rechaza una herramienta fuera de la allowlist SIN tocar la red", async () => {
    const out = await call({ tool: "delete-reservation" });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("debía fallar");
    expect(out.code).toBe("not_allowed");
    expect(out.message).toBe(MCP_ERROR_TEXT.not_allowed);
    expect(state.calls).toHaveLength(0);
    expect(state.inserted[0]?.errorCode).toBe("not_allowed");
  });

  it("con el perfil `generic` la allowlist está vacía: no se invoca nada", async () => {
    const out = await call({
      integration: integration({ profileKey: "generic", profile: generic }),
      tool: "check-availability",
    });
    expect(out.ok).toBe(false);
    expect(state.calls).toHaveLength(0);
  });

  it("`disabled` y el interruptor del dueño cortan antes que nada", async () => {
    const off = await call({ integration: integration({ status: "disabled" }) });
    expect(off.ok).toBe(false);
    const noTools = await call({ integration: integration({ agentToolsEnabled: false }) });
    expect(noTools.ok).toBe(false);
    expect(state.calls).toHaveLength(0);
  });

  it("el prefetch del catálogo NO depende del interruptor del agente", async () => {
    const out = await call({
      integration: integration({ agentToolsEnabled: false }),
      tool: "list-search-options",
      args: {},
      source: "catalog",
    });
    expect(out.ok).toBe(true);
    expect(state.calls).toHaveLength(1);
  });
});

describe("corte de sandbox dentro de callGuarded (corrección #25)", () => {
  it("devuelve fixtures, NO sale a la red y deja la fila is_test=true", async () => {
    const out = await call({
      sandbox: true,
      action: { action: "search_stays", ...SEARCH_ARGS },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("debía andar");
    expect(out.sandbox).toBe(true);
    expect(out.data).not.toBeNull();
    expect(state.calls).toHaveLength(0);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]?.isTest).toBe(true);
    expect(state.inserted[0]?.status).toBe("ok");
  });

  it("el corte va DESPUÉS de la allowlist: una herramienta prohibida no se simula", async () => {
    const out = await call({
      sandbox: true,
      tool: "delete-reservation",
      action: { action: "search_stays", ...SEARCH_ARGS },
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("debía fallar");
    expect(out.code).toBe("not_allowed");
  });

  it("no necesita credencial: el sandbox corre con la fila sin conectar", async () => {
    const out = await call({
      integration: integration({ hasCredential: false, resolveCredential: () => null }),
      sandbox: true,
      action: { action: "search_stays", ...SEARCH_ARGS },
    });
    expect(out.ok).toBe(true);
    expect(state.calls).toHaveLength(0);
  });
});

describe("credencial, cupo y caché", () => {
  it("sin credencial no sale a la red", async () => {
    const out = await call({
      integration: integration({ hasCredential: false, resolveCredential: () => null }),
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("debía fallar");
    expect(out.code).toBe("unauthorized");
    expect(state.calls).toHaveLength(0);
  });

  it("`reconnect_required` no se reintenta en el mismo turno", async () => {
    const out = await call({ integration: integration({ status: "reconnect_required" }) });
    expect(out.ok).toBe(false);
    expect(state.calls).toHaveLength(0);
  });

  it("la segunda consulta idéntica sale de la caché (una sola llamada real)", async () => {
    const first = await call();
    const second = await call();
    expect(first.ok && first.cached).toBe(false);
    expect(second.ok && second.cached).toBe(true);
    expect(state.calls).toHaveLength(1);
    // La traza por conversación queda completa igual (corrección #46).
    expect(state.inserted).toHaveLength(2);
  });

  it("corta a las 60 llamadas por minuto por empresa", async () => {
    for (let i = 0; i < 60; i += 1) {
      const out = await call({ args: { ...SEARCH_ARGS, guests: i + 1 } });
      expect(out.ok).toBe(true);
    }
    const extra = await call({ args: { ...SEARCH_ARGS, guests: 99 } });
    expect(extra.ok).toBe(false);
    if (extra.ok) throw new Error("debía fallar");
    expect(extra.code).toBe("rate_limited");
  });

  it("un presupuesto agotado devuelve timeout sin abrir socket (corrección #11)", async () => {
    const out = await call({ budgetMs: 0 });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("debía fallar");
    expect(out.code).toBe("timeout");
    expect(state.calls).toHaveLength(0);
  });
});

describe("errores: el texto SIEMPRE es nuestro (FR-016, corrección #13)", () => {
  it("un error de herramienta vuelve con el código estable y sus campos", async () => {
    state.next = {
      success: false,
      error: {
        code: "unknown_city",
        message: "TEXTO ELEGIDO POR EL TERCERO",
        accepted: ["Potrero de Garay", "San Clemente"],
      },
    };
    const out = await call();
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("debía fallar");
    expect(out.code).toBe("tool_error");
    expect(out.providerCode).toBe("unknown_city");
    expect(out.details?.accepted).toEqual(["Potrero de Garay", "San Clemente"]);
    expect(out.message).toBe(MCP_ERROR_TEXT.tool_error);
    expect(out.message).not.toContain("TEXTO ELEGIDO");
    const row = state.inserted.at(-1);
    expect(row?.errorCode).toBe("unknown_city");
    expect(String(row?.errorMessage)).not.toContain("TEXTO ELEGIDO");
  });

  it("`unauthorized` deja la integración en reconnect_required", async () => {
    state.rows = [{ id: "mint_1", organizationId: "org_1", status: "connected" }];
    state.throws = new McpError("unauthorized");
    const out = await call();
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("debía fallar");
    expect(out.code).toBe("unauthorized");
    expect(state.updates.some((u) => u.set.status === "reconnect_required")).toBe(true);
  });

  it("un timeout NO degrada el estado: una caída pasajera no es credencial rota", async () => {
    state.rows = [{ id: "mint_1", organizationId: "org_1", status: "connected" }];
    state.throws = new McpError("timeout");
    const out = await call();
    expect(out.ok).toBe(false);
    expect(state.updates.some((u) => u.set.status === "reconnect_required")).toBe(false);
    expect(state.updates.some((u) => u.set.lastErrorCode === "timeout")).toBe(true);
  });

  it("la credencial no aparece en ninguna columna de la bitácora", async () => {
    state.throws = new McpError("http_error");
    await call();
    expect(JSON.stringify(state.inserted)).not.toContain(CREDENTIAL);
  });
});

describe("argsHash", () => {
  it("no depende del orden de las claves", () => {
    expect(argsHash("t", { a: 1, b: 2 })).toBe(argsHash("t", { b: 2, a: 1 }));
  });

  it("distingue herramientas y valores", () => {
    expect(argsHash("t", { a: 1 })).not.toBe(argsHash("u", { a: 1 }));
    expect(argsHash("t", { a: 1 })).not.toBe(argsHash("t", { a: 2 }));
  });
});

describe("handshakeGuarded (corrección #16)", () => {
  it("corta a las 6 verificaciones por minuto", async () => {
    for (let i = 0; i < 6; i += 1) {
      const out = await handshakeGuarded("org_1");
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error("sin fila no puede andar");
      expect(out.code).toBe("not_enabled");
    }
    const extra = await handshakeGuarded("org_1");
    expect(extra.ok).toBe(false);
    if (extra.ok) throw new Error("debía fallar");
    expect(extra.code).toBe("rate_limited");
  });
});
