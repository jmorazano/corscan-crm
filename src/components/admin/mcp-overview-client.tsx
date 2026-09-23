"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Plug,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { mcpErrorText } from "@/lib/mcp/errors";
import { cn } from "@/lib/utils";
import { useQueryFilters } from "@/components/use-query-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Panel CONSOLIDADO de conectores MCP en Administración (016).
 *
 * Existe porque el estado de una conexión no se puede gestionar empresa por
 * empresa: hasta acá el super admin veía la tarjeta de UNA empresa, enterrada
 * en su panel expandido, y con lo que la fila declara de sí misma. La
 * pregunta real —«¿cuál de mis clientes tiene el conector roto?»— solo la
 * contesta la lista completa, con lo roto arriba y la salud de la bitácora al
 * lado.
 *
 * Fronteras que esta pantalla respeta:
 *
 * - **Solo Administración.** `GET /api/admin/mcp` va bajo `withSuperAdmin` y
 *   por eso puede traer la `endpointUrl` COMPLETA (corrección #36). Este
 *   componente no se monta en ninguna vista de empresa, y su DTO tampoco se
 *   reusa ahí.
 * - **La credencial jamás se pinta**: solo «cargada» y los últimos 4.
 * - **Los códigos de error se traducen con `mcpErrorText`** (FR-016,
 *   corrección #13). Ni un byte de texto del servidor remoto llega acá, así
 *   que no hay nada más que mostrar ni se inventa un mensaje propio.
 * - **El nombre de la empresa acompaña TODA acción** (verificar, habilitar,
 *   detalle): el dueño ya habilitó un conector y después no tenía forma de
 *   ver dónde había quedado. Un panel cross-tenant sin el nombre delante es
 *   una forma cómoda de tocarle el conector a la empresa equivocada.
 */

/* ============================================================
 * DTO (espejo de `@/server/mcp/admin`, declarado acá para no arrastrar
 * un módulo de servidor al bundle del cliente)
 * ============================================================ */

type McpConnectorStatus =
  | "enabled"
  | "connected"
  | "reconnect_required"
  | "disabled";

type McpConnectorStatusFilter = McpConnectorStatus | "none";

type SharedWith = { organizationId: string; name: string };

type McpConnectorInfo = {
  profile: string;
  profileName: string;
  label: string;
  /** COMPLETA. Solo se pinta en esta pantalla (super admin). */
  endpointUrl: string;
  endpointHost: string;
  authScheme: "bearer" | "api_key_header";
  status: McpConnectorStatus;
  sessionMode: string;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  toolCount: number;
  credentialLoaded: boolean;
  credentialLast4: string | null;
  agentToolsEnabled: boolean;
  useServerInstructions: boolean;
  timezone: string;
  timeoutMs: number;
  maxResponseBytes: number;
  catalogTtlMinutes: number;
  catalogFetchedAt: string | null;
  catalogStale: boolean;
  enabledAt: string;
  connectedAt: string | null;
  lastHandshakeAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  shared: boolean;
  sharedWith: SharedWith[];
};

type McpConnectorHealth = {
  calls24h: number;
  errors24h: number;
  calls7d: number;
  errors7d: number;
  sandboxCalls24h: number;
  lastCallAt: string | null;
  lastErrorCode: string | null;
  p50Ms: number | null;
  p95Ms: number | null;
  topErrors: { code: string; n: number }[];
};

type McpConnectorRow = {
  organizationId: string;
  organizationName: string;
  connector: McpConnectorInfo | null;
  health: McpConnectorHealth;
};

/** Fila que YA tiene conector (narrowing del `filter`). */
type ConnectedRow = McpConnectorRow & { connector: McpConnectorInfo };

type McpConnectorsSummary = {
  organizations: number;
  withConnector: number;
  connected: number;
  reconnectRequired: number;
  enabled: number;
  disabled: number;
  withErrors24h: number;
};

type McpToolCallEntry = {
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
  argsSummary: Record<string, string | number> | null;
};

type McpConnectorDetail = McpConnectorRow & { recentCalls: McpToolCallEntry[] };

type ListBody = {
  summary: McpConnectorsSummary;
  organizations: McpConnectorRow[];
};

type ApiErrorBody = {
  code?: string;
  message?: string;
  reason?: string;
  mcpCode?: string;
  missingTools?: string[];
  retryInSeconds?: number;
  organization?: McpConnectorDetail;
};

/* ============================================================
 * Etiquetas y formatos
 * ============================================================ */

const STATUS_META: Record<
  McpConnectorStatus,
  { text: string; variant: "success" | "secondary" | "warning" }
> = {
  connected: { text: "Conectada", variant: "success" },
  enabled: { text: "Sin conectar", variant: "secondary" },
  reconnect_required: { text: "Requiere reconexión", variant: "warning" },
  disabled: { text: "Deshabilitada", variant: "secondary" },
};

const STATUS_FILTERS: { value: "" | McpConnectorStatusFilter; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "connected", label: "Conectadas" },
  { value: "reconnect_required", label: "Requieren reconexión" },
  { value: "enabled", label: "Sin conectar" },
  { value: "disabled", label: "Deshabilitadas" },
  { value: "none", label: "Sin conector" },
];

const AUTH_LABEL: Record<"bearer" | "api_key_header", string> = {
  bearer: "Bearer (Authorization)",
  api_key_header: "Clave en encabezado (X-API-Key)",
};

const PROFILE_OPTIONS: { value: string; label: string }[] = [
  {
    value: "altos_de_calamuchita",
    label: "Altos de Calamuchita (alojamientos)",
  },
  {
    value: "generic",
    label: "Servidor MCP genérico (el agente no recibe herramientas)",
  },
];

/**
 * Traducción de cada `reason` del 422 `invalid_endpoint`. Es el mismo mapa
 * que usa la tarjeta por empresa: son textos de primera parte, cortos, y
 * duplicarlos cuesta menos que exportar el de un componente que esta
 * pantalla no toca.
 */
const REASON_TEXT: Record<string, string> = {
  invalid_url: "La dirección no es una URL válida.",
  not_https: "La dirección debe empezar con https://.",
  userinfo: "La dirección no puede llevar usuario y contraseña (user:pass@).",
  bad_port: "Solo se permite el puerto 443.",
  ip_literal: "No se permite una IP literal: usá un nombre de dominio.",
  bad_host: "El nombre de dominio no es válido.",
  too_long: "La dirección es demasiado larga.",
  blocked_host: "Esa dirección apunta a una red interna y no se permite.",
  unresolvable: "El dominio no resuelve. Revisá que esté bien escrito.",
};

const ENABLE_DEFAULTS = {
  timezone: "America/Argentina/Cordoba",
  timeoutMs: 10000,
  maxResponseBytes: 524288,
  catalogTtlMinutes: 60,
};

const RELATIVE = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" });
const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

/** «hace 3 minutos» / «nunca». Todo el panel se lee en tiempo relativo. */
function hace(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "nunca";
  const diff = t - Date.now();
  const abs = Math.abs(diff);
  if (abs < MIN_MS) return "recién";
  if (abs < HOUR_MS) return RELATIVE.format(Math.round(diff / MIN_MS), "minute");
  if (abs < DAY_MS) return RELATIVE.format(Math.round(diff / HOUR_MS), "hour");
  return RELATIVE.format(Math.round(diff / DAY_MS), "day");
}

/** Fecha exacta, para el `title` de lo que se muestra en relativo. */
function fecha(iso: string | null | undefined): string {
  if (!iso) return "sin registro";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "sin registro";
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function duracion(ms: number | null): string {
  if (ms === null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/* ============================================================
 * Panel
 * ============================================================ */

export function McpOverviewClient({
  onChanged,
}: {
  /** Refresca también la lista de empresas de abajo (comparten el estado). */
  onChanged?: () => void | Promise<void>;
}) {
  const { params, set } = useQueryFilters();
  const q = params.get("q") ?? "";
  const statusFilter = params.get("status") ?? "";
  // Pseudo-filtro de salud: no es un estado de la fila, así que se resuelve
  // en el cliente sobre lo que ya devolvió la API.
  const onlyErrors = params.get("errors") === "1";

  const [search, setSearch] = useState(q);
  const [view, setView] = useState<ListBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Una acción por vez, siempre atada al id de la empresa: así el spinner y
  // el resultado no pueden aparecer en la fila equivocada.
  const [verifying, setVerifying] = useState<string | null>(null);
  const [result, setResult] = useState<{
    organizationId: string;
    ok: boolean;
    message: string;
  } | null>(null);

  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const [detail, setDetail] = useState<McpConnectorDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [showWithout, setShowWithout] = useState(false);

  const refetch = useCallback(async () => {
    const qs = new URLSearchParams();
    if (statusFilter) qs.set("status", statusFilter);
    if (q) qs.set("q", q);
    const res = await fetch(`/api/admin/mcp${qs.size ? `?${qs}` : ""}`).catch(
      () => null
    );
    setLoading(false);
    if (!res?.ok) {
      setError("No se pudo cargar el estado de los conectores.");
      return;
    }
    const data = (await res.json().catch(() => null)) as ListBody | null;
    if (!data) {
      setError("No se pudo leer la respuesta del servidor.");
      return;
    }
    setError(null);
    setView(data);
  }, [statusFilter, q]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Búsqueda con debounce → URL (?q=), como en Campañas y Contactos.
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim() !== q) set({ q: search.trim() || null });
    }, 300);
    return () => clearTimeout(t);
  }, [search, q, set]);

  // El filtro de estado abre sola la sección de abajo: si no, elegir «sin
  // conector» dejaría la pantalla vacía sin explicar por qué.
  useEffect(() => {
    if (statusFilter === "none") setShowWithout(true);
  }, [statusFilter]);

  /** Repinta UNA fila con el conector que devolvió una acción. */
  const applyRow = useCallback((row: McpConnectorRow) => {
    setView((prev) =>
      prev
        ? {
            ...prev,
            organizations: prev.organizations.map((r) =>
              r.organizationId === row.organizationId ? { ...r, ...row } : r
            ),
          }
        : prev
    );
  }, []);

  const rows = useMemo(() => view?.organizations ?? [], [view]);
  const visible = useMemo(
    () => (onlyErrors ? rows.filter((r) => r.health.errors24h > 0) : rows),
    [rows, onlyErrors]
  );
  const withConnector = useMemo(
    () =>
      visible.filter((r): r is ConnectedRow => r.connector !== null),
    [visible]
  );
  const withoutConnector = useMemo(
    () => visible.filter((r) => r.connector === null),
    [visible]
  );

  const filtering = statusFilter !== "" || q !== "" || onlyErrors;

  function clearFilters() {
    setSearch("");
    set({ q: null, status: null, errors: null });
  }

  /* ---------- Verificar conexión ---------- */

  async function verify(organizationId: string, organizationName: string) {
    setVerifying(organizationId);
    setResult(null);
    const res = await fetch(`/api/admin/mcp/${organizationId}/verify`, {
      method: "POST",
    }).catch(() => null);
    setVerifying(null);

    if (!res) {
      setResult({
        organizationId,
        ok: false,
        message: `«${organizationName}»: no se pudo contactar a Vocero. Probá de nuevo.`,
      });
      return;
    }

    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; organization?: McpConnectorDetail; error?: ApiErrorBody }
      | null;

    if (res.ok && body?.organization) {
      applyRow(body.organization);
      if (openDetail === organizationId) setDetail(body.organization);
      setResult({
        organizationId,
        ok: true,
        message: `«${organizationName}»: conexión verificada. ${plural(
          body.organization.connector?.toolCount ?? 0,
          "herramienta disponible",
          "herramientas disponibles"
        )}.`,
      });
      void refetch();
      void onChanged?.();
      return;
    }

    const err = body?.error ?? {};
    // El 502 devuelve el conector ya actualizado (con `lastErrorCode`): el
    // fallo también es información y se pinta en la fila.
    if (err.organization) {
      applyRow(err.organization);
      if (openDetail === organizationId) setDetail(err.organization);
    }
    const missing = err.missingTools ?? [];
    const retry =
      typeof err.retryInSeconds === "number"
        ? ` Probá en ${err.retryInSeconds} s.`
        : "";
    // El texto sale de `MCP_ERROR_TEXT` (vía el servidor o vía `mcpErrorText`);
    // nunca se compone uno propio para un fallo del proveedor.
    const text =
      err.message ?? (err.mcpCode ? mcpErrorText(err.mcpCode) : null) ?? "No se pudo verificar la conexión.";
    setResult({
      organizationId,
      ok: false,
      message:
        `«${organizationName}»: ${text}${retry}` +
        (missing.length > 0 ? ` Faltan herramientas: ${missing.join(", ")}.` : ""),
    });
    void onChanged?.();
  }

  /* ---------- Detalle (bitácora) ---------- */

  async function toggleDetail(organizationId: string) {
    if (openDetail === organizationId) {
      setOpenDetail(null);
      setDetail(null);
      return;
    }
    setOpenDetail(organizationId);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    const res = await fetch(`/api/admin/mcp/${organizationId}`).catch(() => null);
    setDetailLoading(false);
    if (!res?.ok) {
      setDetailError("No se pudo cargar el detalle de esta empresa.");
      return;
    }
    const body = (await res.json().catch(() => null)) as {
      organization?: McpConnectorDetail;
    } | null;
    if (!body?.organization) {
      setDetailError("No se pudo leer el detalle de esta empresa.");
      return;
    }
    setDetail(body.organization);
  }

  /* ---------- Habilitar (empresas sin conector) ---------- */

  const [enableFor, setEnableFor] = useState<{
    id: string;
    name: string;
  } | null>(null);

  return (
    <section className="space-y-3" data-testid="mcp-overview">
      <div className="flex flex-wrap items-center gap-2">
        <Plug className="h-4 w-4 text-brand" strokeWidth={1.7} />
        <h3 className="text-sm font-semibold">Conectores MCP</h3>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={loading}
          onClick={() => void refetch()}
          data-testid="mcp-overview-refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />
          Actualizar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Estado de las conexiones que le habilitás a cada empresa: qué conector
        tiene, si la credencial está cargada y si las consultas del agente al
        sistema del cliente están saliendo bien.
      </p>

      {/* ---------- Resumen: cada número es un filtro ---------- */}
      {view && (
        <div
          className="grid grid-cols-2 gap-2 md:grid-cols-4"
          data-testid="mcp-overview-summary"
        >
          <SummaryTile
            label="Con conector"
            value={view.summary.withConnector}
            active={statusFilter === "" && !onlyErrors}
            testId="mcp-summary-with"
            onClick={() => set({ status: null, errors: null })}
          />
          <SummaryTile
            label="Conectadas"
            value={view.summary.connected}
            active={statusFilter === "connected" && !onlyErrors}
            testId="mcp-summary-connected"
            onClick={() => set({ status: "connected", errors: null })}
          />
          <SummaryTile
            label="Requieren reconexión"
            value={view.summary.reconnectRequired}
            tone={view.summary.reconnectRequired > 0 ? "warning" : "muted"}
            active={statusFilter === "reconnect_required" && !onlyErrors}
            testId="mcp-summary-reconnect"
            onClick={() => set({ status: "reconnect_required", errors: null })}
          />
          <SummaryTile
            label="Con errores (24 h)"
            value={view.summary.withErrors24h}
            tone={view.summary.withErrors24h > 0 ? "danger" : "muted"}
            active={onlyErrors}
            testId="mcp-summary-errors"
            onClick={() =>
              set({ errors: onlyErrors ? null : "1", status: null })
            }
          />
        </div>
      )}

      {/* ---------- Filtros ---------- */}
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="mcp-overview-filters"
      >
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value || "all"}
              type="button"
              onClick={() => set({ status: f.value || null })}
              aria-pressed={statusFilter === f.value}
              data-testid={`mcp-status-filter-${f.value || "all"}`}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs transition-colors md:py-1",
                statusFilter === f.value
                  ? "border-brand bg-brand text-white"
                  : "bg-card text-muted-foreground hover:border-brand/50"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-full md:ml-auto md:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar empresa o servidor…"
            className="h-10 pl-8 text-sm md:h-8 md:text-xs"
            data-testid="mcp-overview-search"
            aria-label="Buscar conectores por empresa, servidor o etiqueta"
          />
        </div>
      </div>

      {error && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="mcp-overview-error"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </div>
      )}

      {loading && view === null && !error && (
        <p className="text-sm text-muted-foreground">Cargando conectores…</p>
      )}

      {/* ---------- Lista de empresas CON conector ---------- */}
      {view && view.summary.withConnector === 0 ? (
        <div
          className="rounded-lg border border-dashed px-4 py-6 text-center"
          data-testid="mcp-overview-empty"
        >
          <Plug
            className="mx-auto h-6 w-6 text-muted-foreground"
            strokeWidth={1.7}
          />
          <p className="mt-2 text-sm font-medium">
            Ninguna empresa tiene un conector MCP habilitado
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Un conector MCP enlaza al agente con el sistema del cliente (por
            ejemplo su motor de reservas) para que responda con disponibilidad
            y precios reales. Habilitalo abajo, en «Empresas sin conector».
          </p>
        </div>
      ) : (
        view && (
          <>
            <div
              className="hidden px-3 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_auto] md:gap-3"
              aria-hidden
            >
              <span>Empresa</span>
              <span>Estado</span>
              <span>Salud (24 h)</span>
              <span className="text-right">Acciones</span>
            </div>

            {withConnector.length === 0 ? (
              <div
                className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-4 text-sm text-muted-foreground"
                data-testid="mcp-overview-no-match"
              >
                <span>
                  {statusFilter === "none"
                    ? "Estás filtrando por empresas sin conector: están listadas abajo."
                    : "Ninguna empresa con conector coincide con el filtro."}
                </span>
                {filtering && (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Limpiar filtros
                  </Button>
                )}
              </div>
            ) : (
              <ul className="space-y-2" data-testid="mcp-overview-rows">
                {withConnector.map((row) => (
                  <ConnectorRowItem
                    key={row.organizationId}
                    row={row}
                    verifying={verifying === row.organizationId}
                    busy={verifying !== null}
                    result={
                      result?.organizationId === row.organizationId
                        ? result
                        : null
                    }
                    detailOpen={openDetail === row.organizationId}
                    detail={
                      openDetail === row.organizationId ? detail : null
                    }
                    detailLoading={
                      openDetail === row.organizationId && detailLoading
                    }
                    detailError={
                      openDetail === row.organizationId ? detailError : null
                    }
                    onVerify={() =>
                      void verify(row.organizationId, row.organizationName)
                    }
                    onToggleDetail={() => void toggleDetail(row.organizationId)}
                  />
                ))}
              </ul>
            )}
          </>
        )
      )}

      {/* ---------- Empresas SIN conector (colapsada) ---------- */}
      {view && (
        <div className="rounded-lg border bg-card">
          <button
            type="button"
            onClick={() => setShowWithout((v) => !v)}
            aria-expanded={showWithout}
            data-testid="mcp-overview-without-toggle"
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm"
          >
            {showWithout ? (
              <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={1.7} />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={1.7} />
            )}
            <span className="font-medium">Empresas sin conector</span>
            <Badge variant="secondary">
              {view.summary.organizations - view.summary.withConnector}
            </Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              Habilitar acá evita entrar a la empresa desde la pestaña Empresas
            </span>
          </button>
          {showWithout && (
            <div className="border-t px-4 py-3">
              {withoutConnector.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {filtering
                    ? "El filtro actual deja fuera a las empresas sin conector."
                    : "Todas las empresas tienen conector habilitado."}
                </p>
              ) : (
                <ul className="space-y-2" data-testid="mcp-overview-without">
                  {withoutConnector.map((row) => (
                    <li
                      key={row.organizationId}
                      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
                    >
                      <p className="min-w-0 flex-1 truncate text-sm">
                        {row.organizationName}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`mcp-overview-enable-${row.organizationId}`}
                        onClick={() =>
                          setEnableFor({
                            id: row.organizationId,
                            name: row.organizationName,
                          })
                        }
                      >
                        <Plug className="h-3.5 w-3.5" strokeWidth={1.7} />
                        Habilitar conector
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {enableFor && (
        <EnableDialog
          organizationId={enableFor.id}
          organizationName={enableFor.name}
          onClose={() => setEnableFor(null)}
          onDone={async () => {
            setEnableFor(null);
            await refetch();
            await onChanged?.();
          }}
        />
      )}
    </section>
  );
}

/* ============================================================
 * Piezas
 * ============================================================ */

function SummaryTile({
  label,
  value,
  onClick,
  active,
  tone = "muted",
  testId,
}: {
  label: string;
  value: number;
  onClick: () => void;
  active: boolean;
  tone?: "muted" | "warning" | "danger";
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:border-brand/50",
        active && "border-brand"
      )}
    >
      <span
        className={cn(
          "block text-lg font-semibold leading-tight",
          tone === "warning" && "text-[#8a6d3b]",
          tone === "danger" && "text-[#a2504c]"
        )}
      >
        {value}
      </span>
      <span className="block text-xs text-muted-foreground">{label}</span>
    </button>
  );
}

const ROW_GRID =
  "md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_auto] md:items-start md:gap-3";

function ConnectorRowItem({
  row,
  verifying,
  busy,
  result,
  detailOpen,
  detail,
  detailLoading,
  detailError,
  onVerify,
  onToggleDetail,
}: {
  row: ConnectedRow;
  verifying: boolean;
  busy: boolean;
  result: { ok: boolean; message: string } | null;
  detailOpen: boolean;
  detail: McpConnectorDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  onVerify: () => void;
  onToggleDetail: () => void;
}) {
  const c = row.connector;
  const h = row.health;
  const status = STATUS_META[c.status];
  const broken = c.status === "reconnect_required" || h.errors24h > 0;

  return (
    <li
      className={cn(
        "space-y-3 rounded-lg border bg-card px-3 py-3 md:space-y-0",
        ROW_GRID,
        broken && "border-[#ecd4d2]"
      )}
      data-testid={`mcp-row-${row.organizationId}`}
    >
      {/* Empresa */}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.organizationName}</p>
        <p className="truncate text-xs text-muted-foreground" title={c.endpointHost}>
          {c.profileName} · {c.endpointHost}
        </p>
        {c.shared && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-[#8a6d3b]">
            <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.7} />
            Endpoint compartido con otra empresa
          </p>
        )}
      </div>

      {/* Estado */}
      <div className="min-w-0 space-y-1">
        <Badge variant={status.variant}>{status.text}</Badge>
        <p className="text-xs text-muted-foreground">
          {c.credentialLoaded
            ? `Credencial ••••${c.credentialLast4 ?? ""}`
            : "Sin credencial cargada"}
        </p>
        <p
          className={cn(
            "text-xs",
            c.agentToolsEnabled ? "text-muted-foreground" : "text-[#8a6d3b]"
          )}
        >
          {c.agentToolsEnabled
            ? "Consultas del agente activas"
            : "Consultas del agente apagadas"}
        </p>
      </div>

      {/* Salud 24 h */}
      <div className="min-w-0 space-y-1">
        {h.calls24h === 0 ? (
          <p className="text-xs text-muted-foreground">Sin consultas en 24 h</p>
        ) : (
          <p className="text-xs">
            {plural(h.calls24h, "consulta", "consultas")} ·{" "}
            <span
              className={cn(
                h.errors24h > 0 ? "font-medium text-[#a2504c]" : "text-muted-foreground"
              )}
            >
              {plural(h.errors24h, "error", "errores")}
            </span>
            {h.p95Ms !== null && (
              <span className="text-muted-foreground">
                {" "}
                · p95 {duracion(h.p95Ms)}
              </span>
            )}
          </p>
        )}
        {h.errors24h > 0 && h.lastErrorCode && (
          <p className="text-xs text-[#a2504c]" title={h.lastErrorCode}>
            <AlertTriangle
              className="mr-1 inline h-3.5 w-3.5"
              strokeWidth={1.7}
            />
            {mcpErrorText(h.lastErrorCode)}
          </p>
        )}
        {h.sandboxCalls24h > 0 && (
          <p className="text-xs text-muted-foreground">
            {plural(h.sandboxCalls24h, "consulta", "consultas")} del Laboratorio
            (no salen a la red)
          </p>
        )}
        <p className="text-xs text-muted-foreground" title={fecha(c.lastHandshakeAt)}>
          Última verificación: {hace(c.lastHandshakeAt)}
        </p>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap gap-2 md:justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onVerify}
          data-testid={`mcp-verify-${row.organizationId}`}
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", verifying && "animate-spin")}
            strokeWidth={1.7}
          />
          {verifying ? "Verificando…" : "Verificar conexión"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleDetail}
          aria-expanded={detailOpen}
          data-testid={`mcp-detail-${row.organizationId}`}
        >
          {detailOpen ? "Ocultar detalle" : "Ver detalle"}
        </Button>
      </div>

      {/* Resultado de la acción: siempre con el nombre de la empresa adentro */}
      {result && (
        <p
          className={cn(
            "rounded-md border px-3 py-2 text-xs md:col-span-4 md:mt-3",
            result.ok
              ? "border-[#d8e8dd] bg-[#eff7f1] text-[#3f6b52]"
              : "border-[#ecd4d2] bg-[#faf1f0] text-[#a2504c]"
          )}
          role="status"
          data-testid={`mcp-result-${row.organizationId}`}
        >
          {result.ok ? (
            <Check className="mr-1 inline h-3.5 w-3.5" strokeWidth={2} />
          ) : (
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" strokeWidth={1.7} />
          )}
          {result.message}
        </p>
      )}

      {detailOpen && (
        <div className="md:col-span-4 md:mt-3">
          <ConnectorDetailPanel
            organizationName={row.organizationName}
            detail={detail}
            loading={detailLoading}
            error={detailError}
          />
        </div>
      )}
    </li>
  );
}

function ConnectorDetailPanel({
  organizationName,
  detail,
  loading,
  error,
}: {
  organizationName: string;
  detail: McpConnectorDetail | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <p className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
        Cargando el detalle de «{organizationName}»…
      </p>
    );
  }
  if (error) {
    return (
      <p
        className="rounded-md border border-[#ecd4d2] bg-[#faf1f0] px-3 py-2 text-xs text-[#a2504c]"
        role="alert"
      >
        {error}
      </p>
    );
  }
  if (!detail?.connector) return null;

  const c = detail.connector;
  const calls = detail.recentCalls;

  return (
    <div className="space-y-3 rounded-md border bg-secondary/40 p-3">
      <p className="text-xs font-medium">
        Detalle del conector de «{organizationName}»
      </p>

      <dl className="grid gap-x-4 gap-y-1 text-xs md:grid-cols-2">
        <Field label="Servidor">
          <span className="break-all">{c.endpointUrl}</span>
        </Field>
        <Field label="Etiqueta">{c.label}</Field>
        <Field label="Autenticación">{AUTH_LABEL[c.authScheme]}</Field>
        <Field label="Herramientas publicadas">
          {c.toolCount > 0 ? c.toolCount : "todavía ninguna"}
        </Field>
        <Field label="Servidor informado">
          {c.serverName
            ? `${c.serverName}${c.serverVersion ? ` ${c.serverVersion}` : ""}`
            : "sin handshake"}
        </Field>
        <Field label="Protocolo">{c.protocolVersion ?? "—"}</Field>
        <Field label="Sesión">{c.sessionMode}</Field>
        <Field label="Zona horaria">{c.timezone}</Field>
        <Field label="Espera máxima">{duracion(c.timeoutMs)}</Field>
        <Field label="Catálogo">
          {c.catalogFetchedAt ? (
            <span
              className={cn(c.catalogStale && "text-[#8a6d3b]")}
              title={fecha(c.catalogFetchedAt)}
            >
              actualizado {hace(c.catalogFetchedAt)}
              {c.catalogStale ? " · vencido" : ""}
            </span>
          ) : c.catalogStale ? (
            <span className="text-[#8a6d3b]">sin traer</span>
          ) : (
            "no aplica a este perfil"
          )}
        </Field>
        <Field label="Habilitado">
          <span title={fecha(c.enabledAt)}>{hace(c.enabledAt)}</span>
        </Field>
        <Field label="Primera conexión">
          <span title={fecha(c.connectedAt)}>{hace(c.connectedAt)}</span>
        </Field>
        {c.lastErrorCode && (
          <Field label="Último error">
            <span className="text-[#a2504c]" title={fecha(c.lastErrorAt)}>
              {mcpErrorText(c.lastErrorCode)} (<code>{c.lastErrorCode}</code>,{" "}
              {hace(c.lastErrorAt)})
            </span>
          </Field>
        )}
        {c.sharedWith.length > 0 && (
          <Field label="Mismo servidor que">
            {c.sharedWith.map((s) => s.name).join(", ")}
          </Field>
        )}
      </dl>

      {detail.health.topErrors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Errores de 7 días:</span>
          {detail.health.topErrors.map((e) => (
            <Badge key={e.code} variant="destructive" title={mcpErrorText(e.code)}>
              <code>{e.code}</code>
              <span className="ml-1">· {e.n}</span>
            </Badge>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-medium">Últimas consultas</p>
        {calls.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Todavía no hay consultas registradas para esta empresa.
          </p>
        ) : (
          <ul className="space-y-1">
            {calls.map((call) => (
              <li
                key={call.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-card px-2.5 py-1.5 text-xs"
              >
                <span className="font-medium">{call.tool}</span>
                <Badge variant={call.status === "ok" ? "success" : "destructive"}>
                  {call.status === "ok" ? "OK" : "Error"}
                </Badge>
                {call.errorCode && (
                  // El CÓDIGO es el dato diagnóstico (nuestro de transporte o
                  // el estable del proveedor, ya saneado); el texto sale de
                  // MCP_ERROR_TEXT y nunca del cuerpo remoto.
                  <span className="text-[#a2504c]" title={mcpErrorText(call.errorCode)}>
                    <code>{call.errorCode}</code>
                  </span>
                )}
                {call.httpStatus !== null && (
                  <span className="text-muted-foreground">
                    HTTP {call.httpStatus}
                  </span>
                )}
                <span className="text-muted-foreground">
                  {duracion(call.durationMs)}
                </span>
                {call.isTest && <Badge variant="secondary">Laboratorio</Badge>}
                {call.argsSummary &&
                  Object.entries(call.argsSummary).map(([key, value]) => (
                    <span
                      key={key}
                      className="rounded bg-secondary px-1.5 py-0.5 text-muted-foreground"
                    >
                      {key}: {value}
                    </span>
                  ))}
                <span
                  className="ml-auto text-muted-foreground"
                  title={fecha(call.createdAt)}
                >
                  {hace(call.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Para cambiar la dirección, la credencial o los ajustes avanzados, usá la
        tarjeta «Conector MCP» de {organizationName} en la lista de empresas.
      </p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="shrink-0 text-muted-foreground">{label}:</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/* ============================================================
 * Alta rápida desde el panel
 * ============================================================ */

function EnableDialog({
  organizationId,
  organizationName,
  onClose,
  onDone,
}: {
  organizationId: string;
  organizationName: string;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [profile, setProfile] = useState("altos_de_calamuchita");
  const [label, setLabel] = useState(
    `${organizationName} (reservas)`.slice(0, 80)
  );
  const [endpointUrl, setEndpointUrl] = useState("");
  const [authScheme, setAuthScheme] = useState<"bearer" | "api_key_header">(
    "bearer"
  );
  const [credential, setCredential] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      profile,
      label: label.trim(),
      endpointUrl: endpointUrl.trim(),
      authScheme,
      ...ENABLE_DEFAULTS,
    };
    if (credential.trim().length >= 8) payload.credential = credential.trim();
    const res = await fetch(`/api/admin/organizations/${organizationId}/mcp`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as {
        error?: ApiErrorBody;
      } | null;
      const err = body?.error ?? {};
      const reason = err.reason ? REASON_TEXT[err.reason] : undefined;
      setError(reason ?? err.message ?? "No se pudo habilitar el conector.");
      return;
    }
    await onDone();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      testId="mcp-enable-dialog"
      // El nombre de la empresa encabeza el diálogo: es la acción que el
      // dueño hizo «a ciegas» y después no pudo ubicar.
      title={`Habilitar conector MCP · ${organizationName}`}
      description="La dirección del servidor la fijás solo vos. La empresa nunca la ve ni la escribe."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={
              saving || label.trim().length < 2 || endpointUrl.trim().length < 8
            }
            onClick={() => void save()}
            data-testid="mcp-enable-save"
          >
            {saving ? "Habilitando…" : `Habilitar en ${organizationName}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="mcp-enable-profile">Perfil del proveedor</Label>
          <select
            id="mcp-enable-profile"
            className="flex h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm md:h-9"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
          >
            {PROFILE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mcp-enable-label">Etiqueta visible</Label>
          <Input
            id="mcp-enable-label"
            value={label}
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mcp-enable-url">Dirección del servidor MCP</Label>
          <Input
            id="mcp-enable-url"
            data-testid="mcp-enable-url"
            value={endpointUrl}
            onChange={(e) => setEndpointUrl(e.target.value)}
            placeholder="https://proveedor.example.com/mcp/assistant"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mcp-enable-auth">Forma de autenticación</Label>
          <select
            id="mcp-enable-auth"
            className="flex h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm md:h-9"
            value={authScheme}
            onChange={(e) =>
              setAuthScheme(e.target.value as "bearer" | "api_key_header")
            }
          >
            <option value="bearer">{AUTH_LABEL.bearer}</option>
            <option value="api_key_header">{AUTH_LABEL.api_key_header}</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mcp-enable-credential">Credencial (opcional)</Label>
          <Input
            id="mcp-enable-credential"
            data-testid="mcp-enable-credential"
            type="password"
            autoComplete="off"
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
            placeholder="La puede cargar después el propietario de la empresa"
          />
          <p className="text-xs text-muted-foreground">
            Se guarda cifrada y no se vuelve a mostrar: después solo se ven los
            últimos 4 caracteres.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          Los ajustes avanzados (zona horaria, esperas, vigencia del catálogo)
          quedan en sus valores por defecto y se editan en la tarjeta de la
          empresa.
        </p>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
