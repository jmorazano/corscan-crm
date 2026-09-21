import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  McpConnectorDetail,
  McpConnectorHealth,
  McpConnectorInfo,
  McpConnectorRow,
  McpToolCallEntry,
} from "@/server/mcp/admin";

/**
 * CONTRATO de las rutas del panel consolidado de conectores MCP (016,
 * `specs/016-mcp-connector/contracts/admin-mcp-api.md`).
 *
 * Acá no se testea la agregación (eso es `mcp-admin.test.ts`, sobre las
 * partes puras) sino lo que la ruta PROMETE por HTTP:
 *
 * 1. que sin rol de plataforma no se filtre ni el nombre de una empresa;
 * 2. que la credencial no viaje NUNCA, ni siquiera de rebote dentro de un
 *    objeto anidado — se afirma sobre el JSON serializado entero;
 * 3. que `?q=` y `?status=` recorten la lista sin tocar el `summary`, que es
 *    el semáforo de toda la instancia;
 * 4. que el texto de un handshake fallido salga de `MCP_ERROR_TEXT` y no del
 *    servidor remoto (FR-016, corrección #13).
 *
 * La base no se toca: se mockean los DOS únicos puntos que la consultan
 * (`listMcpConnectors` y `getMcpConnectorDetail`) y se dejan VIVAS las partes
 * puras del módulo, porque el filtrado de la lista es justamente lo que la
 * ruta delega en ellas.
 */

const state = vi.hoisted(() => ({
  /** Email del usuario logueado; `null` = no es super admin (403). */
  superAdmin: true,
  /** Filas que devuelve la capa de datos mockeada. */
  rows: [] as McpConnectorRow[],
  summary: {} as Record<string, number>,
  /** Bitácora del detalle. */
  recentCalls: [] as McpToolCallEntry[],
  /** Resultado que simula `handshakeGuarded`. */
  handshake: { ok: true } as Record<string, unknown>,
  /** Empresas para las que se pidió handshake, en orden. */
  handshakes: [] as string[],
  /** Veces que la ruta consultó la capa de datos (para el caso 403). */
  listCalls: 0,
}));

vi.mock("@/lib/auth/session", () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  class PasswordChangeRequiredError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    PasswordChangeRequiredError,
    requireSuperAdmin: () =>
      state.superAdmin
        ? Promise.resolve({ userId: "u_1", email: "duena@corscan.com" })
        : Promise.reject(new ForbiddenError("no es super admin")),
    requireSession: () => Promise.reject(new Error("no usado aquí")),
    requireSessionUser: () => Promise.reject(new Error("no usado aquí")),
    getSessionOrNull: () => Promise.resolve(null),
  };
});

// Solo los dos accesos a datos se reemplazan: los filtros puros que la ruta
// usa (`parseMcpConnectorFilters`, `filterMcpConnectors`) quedan REALES, que
// es lo que hace que el test de `?q=`/`?status=` signifique algo.
vi.mock("@/server/mcp/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/mcp/admin")>();
  return {
    ...actual,
    listMcpConnectors: () => {
      state.listCalls += 1;
      return Promise.resolve({ summary: state.summary, organizations: state.rows });
    },
    getMcpConnectorDetail: (organizationId: string) => {
      state.listCalls += 1;
      const row = state.rows.find((r) => r.organizationId === organizationId);
      return Promise.resolve(row ? { ...row, recentCalls: state.recentCalls } : null);
    },
  };
});

vi.mock("@/server/mcp/calls", () => ({
  handshakeGuarded: (organizationId: string) => {
    state.handshakes.push(organizationId);
    return Promise.resolve(state.handshake);
  },
}));

vi.mock("@/server/mcp/catalog", () => ({
  refreshCatalog: () => Promise.resolve(),
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

/* ============================================================
 * Fixtures — con la FORMA exacta del DTO del contrato
 * ============================================================ */

/** La credencial real del cliente. No debe aparecer en ninguna respuesta. */
const CREDENCIAL = "sk-altos-de-calamuchita-9f3f9a";

/**
 * Las fixtures se tipan con el DTO REAL, no con `Record<string, unknown>`:
 * así el compilador garantiza que lo que se serializa en estos tests tiene
 * exactamente la forma del contrato, y la afirmación «la credencial no
 * aparece» deja de ser circular (no puedo omitir un campo que el DTO tenga).
 */
type Fila = McpConnectorRow;

/**
 * Garantía de COMPILACIÓN, complementaria a la de runtime: el DTO no declara
 * ningún campo por el que la credencial pudiera viajar. Si alguien agrega uno,
 * esto deja de compilar antes de que ningún test corra.
 */
type ClavesDeSecreto = Extract<
  keyof McpConnectorInfo,
  "credential" | "credentialCipher" | "credentialPlain" | "authToken" | "bearer" | "secret"
>;
const _sinCredencialEnElDto: [ClavesDeSecreto] extends [never] ? true : never = true;
void _sinCredencialEnElDto;

function salud(patch: Partial<McpConnectorHealth> = {}): McpConnectorHealth {
  return {
    calls24h: 0,
    errors24h: 0,
    calls7d: 0,
    errors7d: 0,
    sandboxCalls24h: 0,
    lastCallAt: null,
    lastErrorCode: null,
    p50Ms: null,
    p95Ms: null,
    topErrors: [],
    ...patch,
  };
}

function conector(patch: Partial<McpConnectorInfo> = {}): McpConnectorInfo {
  return {
    profile: "altos_de_calamuchita",
    profileName: "Altos de Calamuchita",
    label: "Altos de Calamuchita (reservas)",
    endpointUrl: "https://altosdecalamuchita.com/mcp/assistant",
    endpointHost: "altosdecalamuchita.com",
    authScheme: "bearer",
    status: "connected",
    sessionMode: "stateless",
    serverName: "altos-mcp",
    serverVersion: "1.4.0",
    protocolVersion: "2025-06-18",
    toolCount: 3,
    credentialLoaded: true,
    // Últimos 4 del secreto: lo ÚNICO de la credencial que puede viajar.
    credentialLast4: CREDENCIAL.slice(-4),
    agentToolsEnabled: true,
    useServerInstructions: false,
    timezone: "America/Argentina/Cordoba",
    timeoutMs: 10000,
    maxResponseBytes: 524288,
    catalogTtlMinutes: 60,
    catalogFetchedAt: "2026-09-21T09:00:00.000Z",
    catalogStale: false,
    enabledAt: "2026-09-01T10:00:00.000Z",
    connectedAt: "2026-09-01T10:05:00.000Z",
    lastHandshakeAt: "2026-09-21T09:00:00.000Z",
    lastErrorCode: null,
    lastErrorAt: null,
    shared: false,
    sharedWith: [],
    ...patch,
  };
}

function fila(patch: Partial<Fila> & Pick<Fila, "organizationId" | "organizationName">): Fila {
  return {
    connector: conector(),
    health: salud(),
    ...patch,
  };
}

/** El escenario por defecto: una conectada, una rota y una sin conector. */
function escenario(): void {
  state.rows = [
    fila({
      organizationId: "org_altos",
      organizationName: "Altos de Calamuchita",
      health: salud({ calls24h: 42, errors24h: 0, calls7d: 310, lastCallAt: "2026-09-21T11:00:00.000Z", p50Ms: 180, p95Ms: 940 }),
    }),
    fila({
      organizationId: "org_cabanas",
      organizationName: "Cabañas del Lago",
      connector: conector({
        label: "Cabañas del Lago (PMS)",
        endpointUrl: "https://pms.cabanasdellago.com/mcp",
        endpointHost: "pms.cabanasdellago.com",
        status: "reconnect_required",
        lastErrorCode: "unauthorized",
        lastErrorAt: "2026-09-21T08:00:00.000Z",
        credentialLast4: "1c2d",
      }),
      health: salud({
        calls24h: 9,
        errors24h: 9,
        calls7d: 60,
        errors7d: 12,
        lastErrorCode: "unauthorized",
        topErrors: [{ code: "unauthorized", n: 12 }],
      }),
    }),
    fila({
      organizationId: "org_drone",
      organizationName: "CorScan Ingeniería",
      connector: null,
    }),
  ];
  state.summary = {
    organizations: 3,
    withConnector: 2,
    connected: 1,
    reconnectRequired: 1,
    enabled: 0,
    disabled: 0,
    withErrors24h: 1,
  };
}

beforeEach(() => {
  state.superAdmin = true;
  state.recentCalls = [];
  state.handshake = { ok: true };
  state.handshakes.length = 0;
  state.listCalls = 0;
  escenario();
});

/* ============================================================
 * Invocación de las rutas
 * ============================================================ */

type Lista = {
  summary: Record<string, number>;
  filters: { q: string; status: string | null };
  organizations: Fila[];
};

function listar(query = ""): Promise<Response> {
  return import("@/app/api/admin/mcp/route").then(({ GET }) =>
    GET(new Request(`http://localhost/api/admin/mcp${query}`))
  );
}

function detalle(id: string): Promise<Response> {
  return import("@/app/api/admin/mcp/[id]/route").then(({ GET }) =>
    GET(new Request(`http://localhost/api/admin/mcp/${id}`), {
      params: Promise.resolve({ id }),
    })
  );
}

function verificar(id: string): Promise<Response> {
  return import("@/app/api/admin/mcp/[id]/verify/route").then(({ POST }) =>
    POST(new Request(`http://localhost/api/admin/mcp/${id}/verify`, { method: "POST" }), {
      params: Promise.resolve({ id }),
    })
  );
}

async function errorDe(res: Response): Promise<Record<string, unknown>> {
  const json = (await res.json()) as { error: Record<string, unknown> };
  return json.error;
}

/* ============================================================
 * Gate de plataforma
 * ============================================================ */

describe("gate: solo el super admin", () => {
  it("usuario sin rol de plataforma → 403 forbidden y NI UNA lectura de datos", async () => {
    state.superAdmin = false;
    const res = await listar();
    expect(res.status).toBe(403);
    expect(await errorDe(res)).toMatchObject({ code: "forbidden" });
    // El 403 llega ANTES de consultar: no se filtra ni el nombre de una empresa.
    expect(state.listCalls).toBe(0);
    expect(JSON.stringify(await (await listar()).json())).not.toContain("Calamuchita");
  });

  it("el gate cubre las tres rutas, incluida la que dispara red", async () => {
    state.superAdmin = false;
    expect((await detalle("org_altos")).status).toBe(403);
    const res = await verificar("org_altos");
    expect(res.status).toBe(403);
    // Lo importante del 403 en verify: no se salió a la red.
    expect(state.handshakes).toEqual([]);
  });
});

/* ============================================================
 * GET /api/admin/mcp
 * ============================================================ */

describe("GET /api/admin/mcp", () => {
  it("trae empresas CON y SIN conector, más el resumen de la instancia", async () => {
    const res = await listar();
    expect(res.status).toBe(200);
    const json = (await res.json()) as Lista;

    expect(json.organizations.map((o) => o.organizationName)).toEqual([
      "Altos de Calamuchita",
      "Cabañas del Lago",
      "CorScan Ingeniería",
    ]);

    // La empresa sin conector NO se omite: el hueco es información (a quién
    // todavía no le habilitaron nada), y su salud va en cero, no en null.
    const sinConector = json.organizations.find((o) => o.organizationId === "org_drone");
    expect(sinConector?.connector).toBeNull();
    expect(sinConector?.health).toMatchObject({ calls24h: 0, calls7d: 0, topErrors: [] });

    // La rota llega con el código del último error y su ranking.
    const rota = json.organizations.find((o) => o.organizationId === "org_cabanas");
    expect(rota?.connector).toMatchObject({
      status: "reconnect_required",
      lastErrorCode: "unauthorized",
    });
    expect(rota?.health).toMatchObject({ errors24h: 9, topErrors: [{ code: "unauthorized", n: 12 }] });

    expect(json.summary).toEqual({
      organizations: 3,
      withConnector: 2,
      connected: 1,
      reconnectRequired: 1,
      enabled: 0,
      disabled: 0,
      withErrors24h: 1,
    });
  });

  it("la CREDENCIAL no aparece en ningún lado del JSON; `credentialLast4` sí", async () => {
    const crudo = await (await listar()).text();

    // Sobre el documento ENTERO, no sobre un campo puntual: si mañana alguien
    // anida el conector dentro de otra cosa, esto sigue valiendo.
    expect(crudo).not.toContain(CREDENCIAL);
    expect(crudo).not.toContain("credentialCipher");
    expect(crudo).not.toContain("credentialPlain");

    // Y ninguna clave con pinta de secreto, a cualquier profundidad.
    const permitidas = new Set(["credentialLoaded", "credentialLast4"]);
    const sospechosas: string[] = [];
    const visitar = (valor: unknown): void => {
      if (Array.isArray(valor)) return valor.forEach(visitar);
      if (valor === null || typeof valor !== "object") return;
      for (const [clave, hijo] of Object.entries(valor)) {
        if (/credential|token|secret|password|authorization|bearer/i.test(clave) && !permitidas.has(clave)) {
          sospechosas.push(clave);
        }
        visitar(hijo);
      }
    };
    visitar(JSON.parse(crudo));
    expect(sospechosas).toEqual([]);

    // Lo que SÍ tiene que estar, para que el operador pueda cotejar con el
    // proveedor sin pedirle la credencial a nadie.
    expect(crudo).toContain(`"credentialLast4":"${CREDENCIAL.slice(-4)}"`);
  });

  it("la `endpointUrl` COMPLETA viaja: esta respuesta es exclusiva del super admin", async () => {
    const json = (await (await listar()).json()) as Lista;
    expect(json.organizations[0]?.connector).toMatchObject({
      endpointUrl: "https://altosdecalamuchita.com/mcp/assistant",
      endpointHost: "altosdecalamuchita.com",
    });
  });
});

/* ============================================================
 * Filtros
 * ============================================================ */

describe("GET /api/admin/mcp — filtros ?q= y ?status=", () => {
  it("`q` recorta por nombre de empresa, host o etiqueta, sin tildes ni mayúsculas", async () => {
    const porNombre = (await (await listar("?q=cabañas")).json()) as Lista;
    expect(porNombre.organizations.map((o) => o.organizationId)).toEqual(["org_cabanas"]);

    // Sin tildes y en mayúsculas encuentra lo mismo.
    const sinTildes = (await (await listar("?q=CABANAS")).json()) as Lista;
    expect(sinTildes.organizations.map((o) => o.organizationId)).toEqual(["org_cabanas"]);

    // Por host: es el dato con el que llama el proveedor cuando algo falla.
    const porHost = (await (await listar("?q=pms.cabanasdellago.com")).json()) as Lista;
    expect(porHost.organizations.map((o) => o.organizationId)).toEqual(["org_cabanas"]);

    // Por etiqueta del conector.
    const porEtiqueta = (await (await listar("?q=PMS")).json()) as Lista;
    expect(porEtiqueta.organizations.map((o) => o.organizationId)).toEqual(["org_cabanas"]);

    const nada = (await (await listar("?q=zzz-no-existe")).json()) as Lista;
    expect(nada.organizations).toEqual([]);
  });

  it("`status` recorta por estado, y `none` es el filtro de «sin conector»", async () => {
    const rotas = (await (await listar("?status=reconnect_required")).json()) as Lista;
    expect(rotas.organizations.map((o) => o.organizationId)).toEqual(["org_cabanas"]);

    const conectadas = (await (await listar("?status=connected")).json()) as Lista;
    expect(conectadas.organizations.map((o) => o.organizationId)).toEqual(["org_altos"]);

    const sinConector = (await (await listar("?status=none")).json()) as Lista;
    expect(sinConector.organizations.map((o) => o.organizationId)).toEqual(["org_drone"]);
  });

  it("los dos filtros se combinan (AND), y un `status` inventado se ignora sin 422", async () => {
    const combinado = (await (await listar("?q=calamuchita&status=connected")).json()) as Lista;
    expect(combinado.organizations.map((o) => o.organizationId)).toEqual(["org_altos"]);
    expect(combinado.filters).toEqual({ q: "calamuchita", status: "connected" });

    const vacio = (await (await listar("?q=calamuchita&status=none")).json()) as Lista;
    expect(vacio.organizations).toEqual([]);

    const inventado = await listar("?status=explotado");
    expect(inventado.status).toBe(200);
    const json = (await inventado.json()) as Lista;
    expect(json.filters.status).toBeNull();
    expect(json.organizations).toHaveLength(3);
  });

  it("filtrar NO toca el `summary`: es el semáforo de toda la instancia", async () => {
    const json = (await (await listar("?status=connected")).json()) as Lista;
    expect(json.organizations).toHaveLength(1);
    expect(json.summary).toMatchObject({ organizations: 3, withConnector: 2, withErrors24h: 1 });
  });
});

/* ============================================================
 * GET /api/admin/mcp/[id]
 * ============================================================ */

describe("GET /api/admin/mcp/[id]", () => {
  it("empresa inexistente → 404 organization_not_found", async () => {
    const res = await detalle("org_fantasma");
    expect(res.status).toBe(404);
    expect(await errorDe(res)).toMatchObject({ code: "organization_not_found" });
  });

  it("empresa real → la fila más la bitácora, sin la credencial", async () => {
    state.recentCalls = [
      {
        id: "mtc_1",
        tool: "check_availability",
        status: "error",
        errorCode: "unauthorized",
        httpStatus: 401,
        durationMs: 812,
        responseBytes: null,
        isTest: false,
        conversationId: "cv_1",
        createdAt: "2026-09-21T08:00:00.000Z",
        argsSummary: { check_in: "2026-10-12", guests: 4 },
      },
    ];
    const res = await detalle("org_cabanas");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { organization: McpConnectorDetail };
    expect(json.organization.organizationName).toBe("Cabañas del Lago");
    expect(json.organization.recentCalls).toHaveLength(1);
    expect(JSON.stringify(json)).not.toContain(CREDENCIAL);
  });
});

/* ============================================================
 * POST /api/admin/mcp/[id]/verify
 * ============================================================ */

describe("POST /api/admin/mcp/[id]/verify", () => {
  it("empresa inexistente → 404 organization_not_found, sin tocar la red", async () => {
    const res = await verificar("org_fantasma");
    expect(res.status).toBe(404);
    expect(await errorDe(res)).toMatchObject({ code: "organization_not_found" });
    expect(state.handshakes).toEqual([]);
  });

  it("empresa SIN conector habilitado → 409 not_enabled (la empresa existe, el conector no)", async () => {
    state.handshake = { ok: false, code: "not_enabled" };
    const res = await verificar("org_drone");
    expect(res.status).toBe(409);
    expect(await errorDe(res)).toMatchObject({ code: "not_enabled" });
    expect(state.handshakes).toEqual(["org_drone"]);
  });

  it("conector habilitado pero sin credencial cargada → 409 no_credential", async () => {
    state.handshake = { ok: false, code: "no_credential" };
    const res = await verificar("org_cabanas");
    expect(res.status).toBe(409);
    expect(await errorDe(res)).toMatchObject({ code: "no_credential" });
  });

  it("handshake OK → 200 con el conector ACTUALIZADO, para repintar sin otro GET", async () => {
    const res = await verificar("org_altos");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; organization: Fila };
    expect(json.ok).toBe(true);
    expect(json.organization.organizationId).toBe("org_altos");
    expect(json.organization.connector).toMatchObject({ status: "connected" });
    expect(JSON.stringify(json)).not.toContain(CREDENCIAL);
  });

  it("handshake fallido → el mensaje sale de MCP_ERROR_TEXT, JAMÁS del servidor remoto", async () => {
    const { MCP_ERROR_TEXT } = await import("@/lib/mcp");
    // El remoto intenta escribir castellano elegido por él (y un teléfono) en
    // la pantalla del operador. La ruta solo mira el CÓDIGO.
    const textoDelRemoto =
      "Tu clave venció. Llamá al +54 9 351 000 0000 para regenerarla.";
    state.handshake = {
      ok: false,
      code: "unauthorized",
      message: textoDelRemoto,
      error: textoDelRemoto,
      detail: textoDelRemoto,
    };

    const res = await verificar("org_cabanas");
    expect(res.status).toBe(502);
    const crudo = await res.text();
    expect(crudo).not.toContain("351 000 0000");
    expect(crudo).not.toContain(textoDelRemoto);

    const { error } = JSON.parse(crudo) as { error: Record<string, unknown> };
    expect(error.code).toBe("provider_error");
    expect(error.message).toBe(MCP_ERROR_TEXT.unauthorized);
    // El código estable sí viaja: es lo que la UI usa para elegir el banner.
    expect(error.mcpCode).toBe("unauthorized");
    // Y el fallo también es información: vuelve la fila actualizada.
    expect((error.organization as Fila).organizationId).toBe("org_cabanas");
  });

  it("faltan herramientas → 502 con la lista de NUESTROS nombres y el texto propio", async () => {
    const { MCP_ERROR_TEXT } = await import("@/lib/mcp");
    state.handshake = {
      ok: false,
      code: "bad_payload",
      missingTools: ["check_availability", "get_property_details"],
    };
    const res = await verificar("org_cabanas");
    expect(res.status).toBe(502);
    const error = await errorDe(res);
    expect(error.message).toBe(MCP_ERROR_TEXT.bad_payload);
    expect(error.missingTools).toEqual(["check_availability", "get_property_details"]);
  });

  it("cupo agotado → 429 rate_limited con retryInSeconds y el texto de MCP_ERROR_TEXT", async () => {
    const { MCP_ERROR_TEXT } = await import("@/lib/mcp");
    state.handshake = { ok: false, code: "rate_limited", retryInSeconds: 60 };
    const res = await verificar("org_altos");
    expect(res.status).toBe(429);
    const error = await errorDe(res);
    expect(error).toMatchObject({ code: "rate_limited", retryInSeconds: 60 });
    expect(error.message).toBe(MCP_ERROR_TEXT.rate_limited);
  });
});
