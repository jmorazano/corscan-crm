import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { McpAuthScheme } from "@/lib/mcp";
import { sanitizeForeignText } from "@/server/mcp/sanitize";
import {
  endpointHostOf,
  type McpRowStatus,
  type McpSessionMode,
  type McpSharedWith,
} from "@/server/mcp/integration";
import { getProfile, isProfileKey, type McpProfileKey } from "@/server/mcp/profiles";

/**
 * Panel CONSOLIDADO de conectores MCP (016 · «gestionar y ver el estado de
 * las conexiones que se le habilitan a cada compañía»).
 *
 * Hasta acá el super admin solo veía la tarjeta de UNA empresa, enterrada en
 * su panel expandido, y con lo que la fila declara de sí misma (perfil, host,
 * estado). Nada de eso dice si la conexión ANDA. Eso lo dice `mcp_tool_call`:
 * cuántas llamadas, cuántas fallaron, con qué código y cuánto tardaron.
 *
 * ## Fronteras (no negociables)
 *
 * - **CROSS-TENANT A PROPÓSITO**: este módulo lee TODAS las empresas de la
 *   instancia sin `scoped()`, con el mismo sombrero que
 *   `src/server/admin/organizations.ts:260-272` y que `sharedWithFor` de
 *   `src/server/mcp/integration.ts:333-353`. Es la excepción CONSCIENTE del
 *   Principio III, no un olvido: una vista por empresa no responde la
 *   pregunta «¿cuáles de mis clientes tienen el conector roto?». Todo lo que
 *   exporta este archivo se sirve ÚNICAMENTE bajo `withSuperAdmin`. La única
 *   query de datos de UNA empresa (la bitácora del detalle) SÍ pasa por
 *   `scoped()`.
 * - **La credencial JAMÁS sale**: solo `credentialLoaded` y `credentialLast4`
 *   (Constitución I, FR-004). La `endpointUrl` completa sí viaja, porque el
 *   consumidor es el super admin (corrección #36) — nunca una ruta de empresa.
 * - **Ni un byte del remoto como texto**: `lastErrorCode` y `topErrors[].code`
 *   son CÓDIGOS (nuestros de transporte o los estables del proveedor, ya
 *   saneados por `sanitizeProviderCode`). El texto lo pone la UI desde
 *   `MCP_ERROR_TEXT` (FR-016, corrección #13).
 * - **El Laboratorio no es tráfico real**: las filas `is_test` NUNCA salieron
 *   a la red, así que contarlas como salud sería mentir. Van aparte, en
 *   `sandboxCalls24h`, que además es la evidencia del sandbox (SC-003).
 *
 * ## Costo
 *
 * Empresas hay pocas; filas de bitácora, muchas. Por eso la salud se resuelve
 * con dos agregados con `GROUP BY organization_id` (uno de contadores y
 * percentiles, otro del ranking de errores) sobre el índice
 * `mcp_tool_call_org_created_idx`, y NUNCA con una query por empresa.
 */

/* ============================================================
 * DTO
 * ============================================================ */

/** Estado del conector tal como lo guarda la fila. */
export type McpConnectorStatus = McpRowStatus;

/** Filtro de estado de la lista: los cuatro de la fila + «sin conector». */
export type McpConnectorStatusFilter = McpConnectorStatus | "none";

export const MCP_CONNECTOR_STATUS_FILTERS: readonly McpConnectorStatusFilter[] = [
  "connected",
  "reconnect_required",
  "enabled",
  "disabled",
  "none",
];

/**
 * El conector de UNA empresa, con todo lo que la fila ya guardaba y nadie
 * mostraba. `endpointUrl` completa: exclusiva del super admin.
 */
export type McpConnectorInfo = {
  profile: McpProfileKey;
  /** Nombre visible del perfil (`getProfile(profile).name`). */
  profileName: string;
  label: string;
  /** COMPLETA. Jamás en una respuesta de empresa (FR-002). */
  endpointUrl: string;
  endpointHost: string;
  authScheme: McpAuthScheme;
  status: McpConnectorStatus;
  sessionMode: McpSessionMode;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  /** Cuántas herramientas expuso el último `tools/list` (no cuáles). */
  toolCount: number;
  /** Hay credencial cifrada guardada. El valor NUNCA sale. */
  credentialLoaded: boolean;
  credentialLast4: string | null;
  agentToolsEnabled: boolean;
  useServerInstructions: boolean;
  timezone: string;
  timeoutMs: number;
  maxResponseBytes: number;
  catalogTtlMinutes: number;
  catalogFetchedAt: string | null;
  /** El catálogo venció su TTL (o nunca se trajo) y hay perfil que lo use. */
  catalogStale: boolean;
  enabledAt: string;
  connectedAt: string | null;
  lastHandshakeAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  /** Otra empresa de la instancia apunta al MISMO host (corrección #23). */
  shared: boolean;
  sharedWith: McpSharedWith[];
};

/** Salud REAL, leída de la bitácora. Sin `is_test`: eso no salió a la red. */
export type McpConnectorHealth = {
  calls24h: number;
  errors24h: number;
  calls7d: number;
  errors7d: number;
  /** Llamadas simuladas del Laboratorio en 24 h. Evidencia, no tráfico. */
  sandboxCalls24h: number;
  lastCallAt: string | null;
  /** Código del error más reciente de los últimos 7 días. */
  lastErrorCode: string | null;
  /** Latencia de las últimas 24 h, redondeada a ms. `null` sin muestras. */
  p50Ms: number | null;
  p95Ms: number | null;
  /** Ranking de códigos de error de 7 días (top 3). */
  topErrors: { code: string; n: number }[];
};

/** Una fila del panel: la empresa, su conector (o `null`) y su salud. */
export type McpConnectorRow = {
  organizationId: string;
  organizationName: string;
  connector: McpConnectorInfo | null;
  health: McpConnectorHealth;
};

/** Resumen global de la instancia. Se calcula SIEMPRE sobre TODAS las filas,
 * nunca sobre el subconjunto filtrado: es el semáforo de la instancia. */
export type McpConnectorsSummary = {
  organizations: number;
  withConnector: number;
  connected: number;
  reconnectRequired: number;
  enabled: number;
  disabled: number;
  /** Empresas con al menos un error real en las últimas 24 h. */
  withErrors24h: number;
};

export type McpConnectorsView = {
  summary: McpConnectorsSummary;
  organizations: McpConnectorRow[];
};

/** Una llamada de la bitácora, para el detalle. Sin `args` completos. */
export type McpToolCallEntry = {
  id: string;
  tool: string;
  status: "ok" | "error";
  errorCode: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  responseBytes: number | null;
  isTest: boolean;
  conversationId: string | null;
  createdAt: string;
  /** Solo campos ESCALARES de una allowlist, saneados y truncados. */
  argsSummary: Record<string, string | number> | null;
};

export type McpConnectorDetail = McpConnectorRow & {
  recentCalls: McpToolCallEntry[];
};

/* ============================================================
 * Partes PURAS (testeables sin base de datos)
 * ============================================================ */

const DAY_MS = 24 * 60 * 60 * 1000;
const HEALTH_WINDOW_DAYS = 7;
const TOP_ERRORS = 3;
const RECENT_CALLS = 20;

/** Salud en cero: la de una empresa sin conector o sin una sola llamada. */
export function emptyHealth(): McpConnectorHealth {
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
  };
}

/**
 * ¿Venció el TTL del catálogo? Misma regla que `isCatalogStale`
 * (`src/server/mcp/catalog.ts:46-53`), pero sobre los campos crudos de la
 * fila, porque acá no hay `McpIntegration` armada.
 *
 * `hasCatalogTool: false` (perfil `generic`) ⇒ **nunca** es "vencido": no hay
 * catálogo que traer, y pintarlo en rojo para siempre sería ruido.
 */
export function isCatalogStaleAt(
  input: {
    hasCatalogTool: boolean;
    catalogFetchedAt: Date | null;
    catalogTtlMinutes: number;
  },
  now: Date = new Date()
): boolean {
  if (!input.hasCatalogTool) return false;
  if (!input.catalogFetchedAt) return true;
  const ageMs = now.getTime() - input.catalogFetchedAt.getTime();
  return ageMs >= input.catalogTtlMinutes * 60_000;
}

/** Fila cruda del agregado de contadores (números ya coercionados). */
export type McpHealthStats = {
  organizationId: string;
  calls24h: number;
  errors24h: number;
  calls7d: number;
  errors7d: number;
  sandboxCalls24h: number;
  lastCallAt: Date | null;
  lastErrorCode: string | null;
  p50Ms: number | null;
  p95Ms: number | null;
};

/** Fila cruda del ranking de errores (`GROUP BY organization_id, error_code`). */
export type McpErrorTally = {
  organizationId: string;
  code: string;
  n: number;
};

/**
 * Ranking de códigos: más frecuente primero y, a igual cantidad, alfabético
 * (sin el desempate, dos renders seguidos podían ordenar distinto).
 */
export function topErrorsFrom(
  tallies: readonly { code: string; n: number }[],
  limit: number = TOP_ERRORS
): { code: string; n: number }[] {
  return [...tallies]
    .filter((t) => t.code.length > 0 && t.n > 0)
    .sort((a, b) => (b.n !== a.n ? b.n - a.n : a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .slice(0, limit)
    .map((t) => ({ code: t.code, n: t.n }));
}

/** Ensambla la salud de UNA empresa. Sin stats ⇒ todo en cero. */
export function buildHealth(
  stats: McpHealthStats | undefined,
  tallies: readonly { code: string; n: number }[] = []
): McpConnectorHealth {
  const base = emptyHealth();
  if (!stats) return { ...base, topErrors: topErrorsFrom(tallies) };
  return {
    calls24h: stats.calls24h,
    errors24h: stats.errors24h,
    calls7d: stats.calls7d,
    errors7d: stats.errors7d,
    sandboxCalls24h: stats.sandboxCalls24h,
    lastCallAt: stats.lastCallAt ? stats.lastCallAt.toISOString() : null,
    lastErrorCode: stats.lastErrorCode,
    p50Ms: stats.p50Ms === null ? null : Math.round(stats.p50Ms),
    p95Ms: stats.p95Ms === null ? null : Math.round(stats.p95Ms),
    topErrors: topErrorsFrom(tallies),
  };
}

/** Resumen global. Se calcula sobre TODAS las filas, no sobre el filtrado. */
export function summarizeConnectors(
  rows: readonly McpConnectorRow[]
): McpConnectorsSummary {
  const byStatus = (status: McpConnectorStatus): number =>
    rows.filter((r) => r.connector?.status === status).length;
  return {
    organizations: rows.length,
    withConnector: rows.filter((r) => r.connector !== null).length,
    connected: byStatus("connected"),
    reconnectRequired: byStatus("reconnect_required"),
    enabled: byStatus("enabled"),
    disabled: byStatus("disabled"),
    withErrors24h: rows.filter((r) => r.health.errors24h > 0).length,
  };
}

/* ---------- Filtros de la lista (puros) ---------- */

export type McpConnectorFilters = {
  /** Texto libre: nombre de la empresa, host o etiqueta del conector. */
  q: string;
  /** `null` = sin filtro de estado. */
  status: McpConnectorStatusFilter | null;
};

function isStatusFilter(value: string): value is McpConnectorStatusFilter {
  return (MCP_CONNECTOR_STATUS_FILTERS as readonly string[]).includes(value);
}

/** Minúsculas y sin tildes: «Calamuchita» encuentra a «calamúchita». */
function norm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** `?q=` y `?status=`. Un `status` desconocido se ignora (no es un 422). */
export function parseMcpConnectorFilters(params: URLSearchParams): McpConnectorFilters {
  const rawStatus = (params.get("status") ?? "").trim();
  return {
    q: (params.get("q") ?? "").trim().slice(0, 120),
    status: isStatusFilter(rawStatus) ? rawStatus : null,
  };
}

export function matchesMcpConnectorFilters(
  row: McpConnectorRow,
  filters: McpConnectorFilters
): boolean {
  if (filters.status !== null) {
    const status: McpConnectorStatusFilter = row.connector?.status ?? "none";
    if (status !== filters.status) return false;
  }
  const q = norm(filters.q);
  if (q.length === 0) return true;
  const haystack = [
    row.organizationName,
    row.connector?.endpointHost ?? "",
    row.connector?.label ?? "",
  ];
  return haystack.some((value) => norm(value).includes(q));
}

export function filterMcpConnectors(
  rows: readonly McpConnectorRow[],
  filters: McpConnectorFilters
): McpConnectorRow[] {
  return rows.filter((row) => matchesMcpConnectorFilters(row, filters));
}

/* ---------- Resumen de argumentos (puro) ---------- */

/**
 * Los `args` de la bitácora los arma NUESTRO pipeline, pero sus valores
 * vienen de lo que escribió el cliente por WhatsApp. Por eso al detalle solo
 * suben campos de una allowlist, escalares, saneados y truncados: sirve para
 * diagnosticar («pidió del 12 al 14 para 4 personas») sin convertir el panel
 * del super admin en una pantalla para texto ajeno (FR-011, corrección #22).
 */
const ARGS_ALLOWLIST = [
  "check_in",
  "check_out",
  "guests",
  "city",
  "property_type",
  "bedrooms",
  "bathrooms",
  "property",
] as const;

export function summarizeCallArgs(
  args: Record<string, unknown> | null | undefined
): Record<string, string | number> | null {
  if (!args || typeof args !== "object") return null;
  const out: Record<string, string | number> = {};
  for (const key of ARGS_ALLOWLIST) {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      // Se aplasta a UNA línea antes de sanear: en la bitácora estos valores
      // se pintan como chips en una tabla, y un salto de línea ahí es tanto
      // un problema de layout como el envoltorio típico de un intento de
      // inyección («…\n\nIGNORÁ TODO Y…»).
      const clean = sanitizeForeignText(value.replace(/\s+/g, " ").trim(), 40);
      if (clean.length > 0) out[key] = clean;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/* ============================================================
 * Lectura (CROSS-TENANT, exclusiva del super admin)
 * ============================================================ */

/** `count(*)` de postgres-js llega como string (int8): se coerciona siempre. */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

type IntegrationRow = typeof schema.mcpIntegration.$inferSelect;

/**
 * Dos agregados con `GROUP BY organization_id` sobre la ventana de 7 días.
 * Constantes en cantidad de queries: no crecen con la cantidad de empresas.
 */
async function readHealth(now: Date): Promise<{
  stats: Map<string, McpHealthStats>;
  tallies: Map<string, McpErrorTally[]>;
}> {
  const db = getDb();
  const since24h = new Date(now.getTime() - DAY_MS);
  const since7d = new Date(now.getTime() - HEALTH_WINDOW_DAYS * DAY_MS);

  const real = eq(schema.mcpToolCall.isTest, false);
  const simulated = eq(schema.mcpToolCall.isTest, true);
  const failed = eq(schema.mcpToolCall.status, "error");
  const in24h = gte(schema.mcpToolCall.createdAt, since24h);
  const timed = isNotNull(schema.mcpToolCall.durationMs);
  const coded = isNotNull(schema.mcpToolCall.errorCode);
  // La ventana de 7 días la pone el WHERE: dentro de los `filter` alcanza con
  // acotar a 24 h cuando corresponde.
  const window = gte(schema.mcpToolCall.createdAt, since7d);

  const [statsRows, tallyRows] = await Promise.all([
    db
      .select({
        organizationId: schema.mcpToolCall.organizationId,
        calls24h: sql<number>`count(*) filter (where ${and(real, in24h)})`,
        errors24h: sql<number>`count(*) filter (where ${and(real, failed, in24h)})`,
        calls7d: sql<number>`count(*) filter (where ${real})`,
        errors7d: sql<number>`count(*) filter (where ${and(real, failed)})`,
        sandboxCalls24h: sql<number>`count(*) filter (where ${and(simulated, in24h)})`,
        lastCallAt: sql<
          Date | null
        >`max(${schema.mcpToolCall.createdAt}) filter (where ${real})`,
        // El código del error MÁS RECIENTE: un solo agregado ordenado, sin
        // segunda vuelta a la tabla.
        lastErrorCode: sql<string | null>`(array_agg(${schema.mcpToolCall.errorCode} order by ${schema.mcpToolCall.createdAt} desc) filter (where ${and(real, failed, coded)}))[1]`,
        p50Ms: sql<number | null>`percentile_cont(0.5) within group (order by ${schema.mcpToolCall.durationMs}) filter (where ${and(real, in24h, timed)})`,
        p95Ms: sql<number | null>`percentile_cont(0.95) within group (order by ${schema.mcpToolCall.durationMs}) filter (where ${and(real, in24h, timed)})`,
      })
      .from(schema.mcpToolCall)
      .where(window)
      .groupBy(schema.mcpToolCall.organizationId),
    db
      .select({
        organizationId: schema.mcpToolCall.organizationId,
        code: schema.mcpToolCall.errorCode,
        n: count(),
      })
      .from(schema.mcpToolCall)
      .where(and(window, real, failed, coded))
      .groupBy(schema.mcpToolCall.organizationId, schema.mcpToolCall.errorCode),
  ]);

  const stats = new Map<string, McpHealthStats>();
  for (const r of statsRows) {
    stats.set(r.organizationId, {
      organizationId: r.organizationId,
      calls24h: num(r.calls24h),
      errors24h: num(r.errors24h),
      calls7d: num(r.calls7d),
      errors7d: num(r.errors7d),
      sandboxCalls24h: num(r.sandboxCalls24h),
      lastCallAt: toDate(r.lastCallAt),
      lastErrorCode: typeof r.lastErrorCode === "string" ? r.lastErrorCode : null,
      p50Ms: nullableNum(r.p50Ms),
      p95Ms: nullableNum(r.p95Ms),
    });
  }

  const tallies = new Map<string, McpErrorTally[]>();
  for (const r of tallyRows) {
    if (!r.code) continue;
    const list = tallies.get(r.organizationId) ?? [];
    list.push({ organizationId: r.organizationId, code: r.code, n: num(r.n) });
    tallies.set(r.organizationId, list);
  }

  return { stats, tallies };
}

function toConnectorInfo(
  row: IntegrationRow,
  sharedWith: McpSharedWith[],
  now: Date
): McpConnectorInfo {
  const profileKey: McpProfileKey = isProfileKey(row.profile) ? row.profile : "generic";
  const profile = getProfile(profileKey);
  const tools = Array.isArray(row.tools) ? row.tools : [];
  return {
    profile: profileKey,
    profileName: profile.name,
    label: row.label,
    endpointUrl: row.endpointUrl,
    endpointHost: endpointHostOf(row.endpointUrl),
    authScheme: row.authScheme,
    status: row.status,
    sessionMode: row.sessionMode,
    serverName: row.serverName,
    serverVersion: row.serverVersion,
    protocolVersion: row.protocolVersion,
    toolCount: tools.length,
    credentialLoaded: row.credential !== null && row.credential !== undefined,
    credentialLast4: row.credentialLast4,
    agentToolsEnabled: row.agentToolsEnabled,
    useServerInstructions: row.useServerInstructions,
    timezone: row.timezone,
    timeoutMs: row.timeoutMs,
    maxResponseBytes: row.maxResponseBytes,
    catalogTtlMinutes: row.catalogTtlMinutes,
    catalogFetchedAt: row.catalogFetchedAt?.toISOString() ?? null,
    catalogStale: isCatalogStaleAt(
      {
        hasCatalogTool: typeof profile.catalogTool === "string" && profile.catalogTool.length > 0,
        catalogFetchedAt: row.catalogFetchedAt,
        catalogTtlMinutes: row.catalogTtlMinutes,
      },
      now
    ),
    enabledAt: row.enabledAt.toISOString(),
    connectedAt: row.connectedAt?.toISOString() ?? null,
    lastHandshakeAt: row.lastHandshakeAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    shared: sharedWith.length > 0,
    sharedWith,
  };
}

/**
 * LA vista consolidada: TODAS las empresas de la instancia, con y sin
 * conector, cada una con su salud real.
 *
 * Sin `scoped()` A PROPÓSITO (ver el encabezado del archivo): se sirve solo
 * bajo `withSuperAdmin`.
 */
export async function listMcpConnectors(
  now: Date = new Date()
): Promise<McpConnectorsView> {
  const db = getDb();

  const [orgs, integrations, health] = await Promise.all([
    db
      .select({ id: schema.organization.id, name: schema.organization.name })
      .from(schema.organization),
    db.select().from(schema.mcpIntegration),
    readHealth(now),
  ]);

  // Empresas que comparten host (corrección #23): se arma UNA vez para toda
  // la lista en vez de una query por conector, como hacía `sharedWithFor`.
  const nameById = new Map(orgs.map((o) => [o.id, o.name]));
  const byHost = new Map<string, string[]>();
  for (const row of integrations) {
    const host = endpointHostOf(row.endpointUrl);
    if (!host) continue;
    const list = byHost.get(host) ?? [];
    list.push(row.organizationId);
    byHost.set(host, list);
  }

  const integrationByOrg = new Map(integrations.map((r) => [r.organizationId, r]));

  const rows: McpConnectorRow[] = orgs
    .map((org) => {
      const row = integrationByOrg.get(org.id);
      let connector: McpConnectorInfo | null = null;
      if (row) {
        const host = endpointHostOf(row.endpointUrl);
        const sharedWith: McpSharedWith[] = (byHost.get(host) ?? [])
          .filter((id) => id !== org.id)
          .map((id) => ({ organizationId: id, name: nameById.get(id) ?? "" }));
        connector = toConnectorInfo(row, sharedWith, now);
      }
      return {
        organizationId: org.id,
        organizationName: org.name,
        connector,
        health: buildHealth(health.stats.get(org.id), health.tallies.get(org.id) ?? []),
      };
    })
    // Primero lo que necesita atención, después alfabético: el panel se lee
    // de arriba hacia abajo y lo roto tiene que estar arriba.
    .sort((a, b) => {
      const weight = (r: McpConnectorRow): number => {
        if (!r.connector) return 3;
        if (r.connector.status === "reconnect_required") return 0;
        if (r.health.errors24h > 0) return 1;
        return 2;
      };
      const diff = weight(a) - weight(b);
      if (diff !== 0) return diff;
      return a.organizationName.localeCompare(b.organizationName, "es");
    });

  return { summary: summarizeConnectors(rows), organizations: rows };
}

/**
 * El mismo DTO para UNA empresa + las últimas 20 llamadas de su bitácora.
 *
 * Reusa `listMcpConnectors` en vez de duplicar el armado: garantiza que el
 * detalle y la lista digan EXACTAMENTE lo mismo, y con la cantidad de
 * empresas de una instancia el costo es el de dos agregados.
 */
export async function getMcpConnectorDetail(
  organizationId: string,
  now: Date = new Date()
): Promise<McpConnectorDetail | null> {
  const view = await listMcpConnectors(now);
  const row = view.organizations.find((r) => r.organizationId === organizationId);
  if (!row) return null;
  return { ...row, recentCalls: await listRecentCalls(organizationId) };
}

/**
 * Últimas llamadas de UNA empresa. Acá sí `scoped()` (Principio III): es la
 * única lectura de datos de dominio de una sola empresa de este módulo.
 */
export async function listRecentCalls(
  organizationId: string,
  limit: number = RECENT_CALLS
): Promise<McpToolCallEntry[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.mcpToolCall.id,
      tool: schema.mcpToolCall.tool,
      args: schema.mcpToolCall.args,
      status: schema.mcpToolCall.status,
      errorCode: schema.mcpToolCall.errorCode,
      httpStatus: schema.mcpToolCall.httpStatus,
      durationMs: schema.mcpToolCall.durationMs,
      responseBytes: schema.mcpToolCall.responseBytes,
      isTest: schema.mcpToolCall.isTest,
      conversationId: schema.mcpToolCall.conversationId,
      createdAt: schema.mcpToolCall.createdAt,
    })
    .from(schema.mcpToolCall)
    .where(scoped(schema.mcpToolCall.organizationId, organizationId))
    .orderBy(desc(schema.mcpToolCall.createdAt), desc(schema.mcpToolCall.id))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    tool: r.tool,
    status: r.status,
    errorCode: r.errorCode,
    httpStatus: r.httpStatus,
    durationMs: r.durationMs,
    responseBytes: r.responseBytes,
    isTest: r.isTest,
    conversationId: r.conversationId,
    createdAt: (toDate(r.createdAt) ?? new Date(0)).toISOString(),
    argsSummary: summarizeCallArgs(r.args),
  }));
}
