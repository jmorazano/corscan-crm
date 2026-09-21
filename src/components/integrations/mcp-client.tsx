"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  KeyRound,
  Plug,
  Search,
  ServerCog,
  Unplug,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Conector MCP de la empresa (016, US2): conexión, diagnóstico del servidor,
 * permiso del agente y **búsqueda de prueba** — el «lo probé y anda» del
 * dueño.
 *
 * Dos cosas que esta pantalla JAMÁS muestra, porque la API nunca las manda
 * (contrato `mcp-integration-api.md`): la credencial (solo los últimos 4) y
 * la `endpointUrl` completa (solo el host). La dirección la fija el super
 * admin; acá se pega la credencial que pasó el proveedor.
 *
 * Todo texto que viene del proveedor (descripción de herramientas,
 * `instructions`, nombres de propiedades) llega saneado desde el server y se
 * muestra **rotulado como texto sin verificar** (corrección #22).
 */

/* ============================================================
 * Tipos — espejo del DTO del contrato (mismo criterio que
 * google-calendar-client.tsx: la UI declara lo que consume).
 * ============================================================ */

type McpStatus = "enabled" | "connected" | "reconnect_required" | "disabled";

type ToolView = {
  name: string;
  description: string | null;
  readOnly: boolean;
};

type CatalogView = {
  propertyTypes: string[];
  cities: string[];
  facilitiesCount: number;
  window: { from: string; to: string } | null;
  currency: string;
  maxGuests?: number | null;
};

type IntegrationView = {
  profile: string;
  profileName: string;
  label: string;
  /** SOLO el host (FR-002). */
  endpointHost: string;
  status: McpStatus;
  credentialLast4: string | null;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  sessionMode: "stateless" | "initialize";
  timezone: string;
  tools: ToolView[];
  instructions: string | null;
  useServerInstructions: boolean;
  agentToolsEnabled: boolean;
  catalog: CatalogView | null;
  catalogFetchedAt: string | null;
  lastHandshakeAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  enabledAt: string;
};

type Response_ = {
  available: boolean;
  integration: IntegrationView | null;
  canManage: boolean;
};

type PreviewPricing = {
  currency: string;
  nights: number;
  pricePerNight: number | null;
  accommodation: number | null;
  services: number | null;
  total: number | null;
  deposit: number | null;
};

type PreviewProperty = {
  code: string;
  name: string;
  city: string | null;
  capacity: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  minStay: number | null;
  facilities: string[];
  pricing: PreviewPricing | null;
  url: string | null;
};

type PreviewResult = {
  message: string | null;
  searchUrl: string | null;
  availableCount: number;
  properties: PreviewProperty[];
};

type ApiErrorBody = {
  code?: string;
  message?: string;
  mcpCode?: string;
  providerCode?: string;
  missingTools?: string[];
  retryInSeconds?: number;
};

/* ============================================================
 * Textos — de primera parte, siempre. Ni un byte del remoto.
 * ============================================================ */

const ERROR_TEXT: Record<string, string> = {
  unauthorized:
    "El servidor rechazó la credencial. Pedile una nueva al proveedor y volvé a cargarla.",
  timeout: "El servidor no respondió a tiempo. Probá de nuevo en un minuto.",
  blocked_host:
    "La dirección del servidor no es válida. Avisale al administrador de la instancia.",
  invalid_url:
    "La dirección del servidor no es válida. Avisale al administrador de la instancia.",
  unexpected_redirect:
    "El servidor respondió con una redirección; por seguridad no la seguimos.",
  bad_content_type: "El servidor respondió en un formato que no podemos leer.",
  bad_payload: "El servidor respondió algo que no pudimos interpretar.",
  rpc_error: "El servidor respondió algo que no pudimos interpretar.",
  too_large: "La respuesta del servidor es demasiado grande.",
  tool_error: "El servidor rechazó la consulta.",
  not_allowed: "Esa consulta no está habilitada para este servidor.",
  rate_limited: "Muchas consultas seguidas. Esperá un minuto.",
  busy: "El sistema está atendiendo muchas consultas. Probá de nuevo en un momento.",
  sandbox_violation:
    "Las conversaciones de prueba no consultan el servidor real.",
  http_error: "No se pudo conectar con el servidor.",
};

const FALLBACK_ERROR = "No se pudo conectar con el servidor.";

/** Ayuda propia por código ESTABLE del proveedor (nunca su texto). */
const PROVIDER_HELP: Record<string, string> = {
  unknown_city: "El servidor no reconoce esa localidad. Probá con una de las del catálogo.",
  date_out_of_window:
    "Para esas fechas el servidor todavía no tiene precios publicados. Probá dentro de la ventana del catálogo.",
  invalid_guests: "Esa cantidad de huéspedes está fuera de lo que acepta el servidor.",
  unknown_property_type: "Ese tipo de alojamiento no figura en el catálogo del servidor.",
  invalid_date_range: "La fecha de salida tiene que ser posterior a la de entrada.",
  property_not_found: "El servidor no encontró esa propiedad.",
};

/** Texto de primera parte para un código, tolerando códigos desconocidos. */
function errorTextFor(code: string | undefined | null): string {
  if (!code) return FALLBACK_ERROR;
  return ERROR_TEXT[code] ?? FALLBACK_ERROR;
}

async function readApiError(res: Response | null): Promise<ApiErrorBody> {
  if (!res) return {};
  const body = (await res.json().catch(() => null)) as {
    error?: ApiErrorBody;
  } | null;
  return body?.error ?? {};
}

/** Mensaje mostrable de una respuesta fallida (jamás texto del remoto). */
function messageFromError(err: ApiErrorBody): string {
  if (err.mcpCode) return errorTextFor(err.mcpCode);
  if (err.message) return err.message;
  return errorTextFor(err.code);
}

function formatMoney(value: number | null, currency: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    // Moneda que Intl no conoce: se imprime tal cual, jamás se convierte.
    return `${currency} ${value}`;
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("es-AR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
  } catch {
    return iso;
  }
}

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const STATUS_BADGE: Record<
  McpStatus,
  { label: string; variant: "success" | "secondary" | "warning" }
> = {
  connected: { label: "Conectada", variant: "success" },
  enabled: { label: "No conectada", variant: "secondary" },
  reconnect_required: { label: "Requiere reconexión", variant: "warning" },
  disabled: { label: "Deshabilitada", variant: "secondary" },
};

/* ============================================================
 * Raíz
 * ============================================================ */

export function McpClient() {
  const [data, setData] = useState<Response_ | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/integrations/mcp").catch(() => null);
    if (!res?.ok) return;
    setData((await res.json()) as Response_);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!data) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  const integration = data.integration;
  if (!integration) {
    return (
      <p className="text-sm text-muted-foreground">
        Esta empresa no tiene el conector habilitado. Pedile al administrador de
        la instancia que lo habilite desde Administración.
      </p>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {notice && (
        <p
          className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] px-3 py-2 text-sm text-[#3f6b52]"
          role="status"
          data-testid="mcp-notice"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          className="rounded-md border border-[#ecd4d2] bg-[#faf1f0] px-3 py-2 text-sm text-[#a2504c]"
          role="alert"
          data-testid="mcp-error"
        >
          {error}
        </p>
      )}
      <ConnectionCard
        integration={integration}
        canManage={data.canManage}
        onChanged={refetch}
        onError={setError}
        onNotice={setNotice}
      />
      {integration.status === "connected" && (
        <ServerCard
          integration={integration}
          canManage={data.canManage}
          onChanged={refetch}
          onError={setError}
        />
      )}
      <AgentCard
        integration={integration}
        canManage={data.canManage}
        onChanged={refetch}
        onError={setError}
      />
      {integration.status === "connected" && (
        <PreviewCard integration={integration} canManage={data.canManage} />
      )}
      <KbConflictCard />
    </div>
  );
}

/* ============================================================
 * Conexión
 * ============================================================ */

function ConnectionCard({
  integration,
  canManage,
  onChanged,
  onError,
  onNotice,
}: {
  integration: IntegrationView;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const [credential, setCredential] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const badge = STATUS_BADGE[integration.status];
  const hasCredential = integration.credentialLast4 !== null;
  const showForm = !hasCredential || editing;

  /** Cargar/rotar la credencial y verificar en el mismo gesto. */
  async function connect() {
    setBusy(true);
    onError(null);
    onNotice(null);
    const put = await fetch("/api/integrations/mcp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential }),
    }).catch(() => null);
    if (!put?.ok) {
      setBusy(false);
      onError(messageFromError(await readApiError(put)));
      return;
    }
    setCredential("");
    setEditing(false);
    await verify({ silent: true });
    setBusy(false);
  }

  async function verify(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setBusy(true);
      onError(null);
      onNotice(null);
    }
    const res = await fetch("/api/integrations/mcp/verify", {
      method: "POST",
    }).catch(() => null);
    if (!options?.silent) setBusy(false);
    if (!res?.ok) {
      const err = await readApiError(res);
      const missing = err.missingTools ?? [];
      onError(
        missing.length > 0
          ? `${messageFromError(err)} Faltan herramientas: ${missing.join(", ")}.`
          : messageFromError(err)
      );
      await onChanged();
      return;
    }
    onNotice("Conexión verificada: el servidor respondió correctamente.");
    await onChanged();
  }

  async function disconnect() {
    setBusy(true);
    onError(null);
    const res = await fetch("/api/integrations/mcp", {
      method: "DELETE",
    }).catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!res?.ok) {
      onError(messageFromError(await readApiError(res)));
      return;
    }
    onNotice(
      "Conector desconectado. El agente deja de consultar el sistema de reservas."
    );
    await onChanged();
  }

  return (
    <Card data-testid="mcp-connection">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-brand" strokeWidth={1.7} />
            Conexión
          </CardTitle>
          <Badge variant={badge.variant} data-testid="mcp-status">
            {badge.label}
          </Badge>
        </div>
        <CardDescription>
          La dirección del servidor la carga el administrador de la instancia.
          Acá solo va la credencial que te pasó el proveedor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-4 md:px-5 md:pb-5">
        <dl className="space-y-2 text-sm">
          <Row label="Servidor">
            <span className="break-all" data-testid="mcp-host">
              {integration.endpointHost}
            </span>
          </Row>
          <Row label="Perfil">{integration.profileName}</Row>
          <Row label="Zona horaria">{integration.timezone}</Row>
          <Row label="Credencial">
            {hasCredential ? (
              <span data-testid="mcp-credential-last4">
                Cargada (termina en ••••{integration.credentialLast4})
              </span>
            ) : (
              <span className="text-muted-foreground">Sin cargar</span>
            )}
          </Row>
        </dl>

        {integration.status === "enabled" && !hasCredential && (
          <p className="text-sm text-muted-foreground" data-testid="mcp-empty">
            Este servidor todavía no está conectado. Pegá la credencial que te
            pasó el proveedor y tocá Conectar.
          </p>
        )}

        {integration.status === "reconnect_required" && (
          <p
            className="rounded-md border border-[#ece2cf] bg-[#faf7f0] px-3 py-2 text-sm text-[#8a6d3b]"
            role="alert"
            data-testid="mcp-reconnect-banner"
          >
            El servidor rechazó la credencial. Mientras tanto el agente no
            consulta disponibilidad: avisa que el equipo la confirma.
          </p>
        )}

        {integration.status === "connected" && integration.lastErrorCode && (
          <p className="text-xs text-muted-foreground">
            Último problema: {errorTextFor(integration.lastErrorCode)} (
            {formatDateTime(integration.lastErrorAt)})
          </p>
        )}

        {canManage ? (
          <fieldset disabled={busy} className="min-w-0 space-y-3">
            {showForm && (
              <div className="space-y-1.5">
                <Label htmlFor="mcp-credential">
                  Credencial del proveedor
                </Label>
                <Input
                  id="mcp-credential"
                  data-testid="mcp-credential"
                  type="password"
                  autoComplete="off"
                  placeholder="Pegá acá el token que te dio el proveedor"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Se guarda cifrada y no se vuelve a mostrar: solo verás sus
                  últimos 4 caracteres.
                </p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {showForm && (
                <Button
                  onClick={() => void connect()}
                  disabled={credential.trim().length < 8}
                  data-testid="mcp-connect"
                >
                  <KeyRound className="h-4 w-4" strokeWidth={1.7} />
                  {busy ? "Conectando…" : hasCredential ? "Guardar credencial" : "Conectar"}
                </Button>
              )}
              {showForm && editing && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setCredential("");
                  }}
                >
                  Cancelar
                </Button>
              )}
              {hasCredential && !editing && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  Cambiar credencial
                </Button>
              )}
              {hasCredential && (
                <Button
                  variant="outline"
                  onClick={() => void verify()}
                  data-testid="mcp-verify"
                >
                  {busy ? "Verificando…" : "Verificar conexión"}
                </Button>
              )}
              {hasCredential && !confirming && (
                <Button
                  variant="outline"
                  onClick={() => setConfirming(true)}
                  data-testid="mcp-disconnect"
                >
                  <Unplug className="h-4 w-4" strokeWidth={1.7} />
                  Desconectar
                </Button>
              )}
            </div>
            {confirming && (
              // Confirmación inline en dos pasos (no un diálogo): en 375 px
              // se apila y siempre entra en pantalla.
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>
                  ¿Desconectar? El CRM olvida la credencial y el agente deja de
                  consultar disponibilidad.
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void disconnect()}
                  data-testid="mcp-disconnect-confirm"
                >
                  Sí, desconectar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirming(false)}
                >
                  Cancelar
                </Button>
              </div>
            )}
          </fieldset>
        ) : (
          <p className="text-xs text-muted-foreground">
            Solo el propietario puede conectar o desconectar el servidor.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <dt className="w-32 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

/* ============================================================
 * Servidor: qué expone y qué texto suyo entra al modelo
 * ============================================================ */

function ServerCard({
  integration,
  canManage,
  onChanged,
  onError,
}: {
  integration: IntegrationView;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const catalog = integration.catalog;

  async function toggleInstructions(value: boolean) {
    setSaving(true);
    onError(null);
    const res = await fetch("/api/integrations/mcp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ useServerInstructions: value }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      onError(messageFromError(await readApiError(res)));
      return;
    }
    await onChanged();
  }

  return (
    <Card data-testid="mcp-server">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ServerCog className="h-4 w-4 text-brand" strokeWidth={1.7} />
          Servidor
        </CardTitle>
        <CardDescription>
          Lo que el servidor declaró en el último handshake. Las descripciones
          y las notas las escribe el proveedor: las mostramos tal cual llegan,
          sin verificarlas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-4 md:px-5 md:pb-5">
        <dl className="space-y-2 text-sm">
          <Row label="Nombre">
            {integration.serverName ?? "—"}
            {integration.serverVersion ? ` v${integration.serverVersion}` : ""}
          </Row>
          <Row label="Protocolo">{integration.protocolVersion ?? "—"}</Row>
          <Row label="Sesión">
            {integration.sessionMode === "stateless"
              ? "Sin estado"
              : "Con handshake previo"}
          </Row>
          <Row label="Handshake">
            {formatDateTime(integration.lastHandshakeAt)}
          </Row>
        </dl>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Herramientas descubiertas ({integration.tools.length})
          </p>
          {integration.tools.length === 0 && (
            <p className="text-sm text-muted-foreground">
              El servidor no declaró ninguna herramienta.
            </p>
          )}
          <ul className="space-y-2">
            {integration.tools.map((tool) => (
              <li
                key={tool.name}
                className="rounded-md border p-3"
                data-testid={`mcp-tool-${tool.name}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all text-xs font-medium">
                    {tool.name}
                  </code>
                  <Badge variant={tool.readOnly ? "secondary" : "warning"}>
                    {tool.readOnly ? "Solo lectura" : "Escribe"}
                  </Badge>
                </div>
                {tool.description && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium">
                      Texto del proveedor (sin verificar):
                    </span>{" "}
                    {tool.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>

        {catalog && (
          <div className="space-y-1 rounded-md border p-3 text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Catálogo del proveedor
            </p>
            <p>
              <span className="text-muted-foreground">Tipos: </span>
              {catalog.propertyTypes.join(", ") || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Localidades: </span>
              {catalog.cities.join(", ") || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Características: </span>
              {catalog.facilitiesCount}
            </p>
            <p>
              <span className="text-muted-foreground">Ventana con precios: </span>
              {catalog.window
                ? `${catalog.window.from} → ${catalog.window.to}`
                : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              Moneda {catalog.currency} · actualizado{" "}
              {formatDateTime(integration.catalogFetchedAt)}
            </p>
          </div>
        )}

        {integration.instructions && (
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Notas del proveedor (informativas)
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
              {integration.instructions}
            </p>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={integration.useServerInstructions}
                disabled={!canManage || saving}
                onChange={(e) => void toggleInstructions(e.target.checked)}
                data-testid="mcp-use-instructions"
              />
              <span>
                Usar estas notas en el prompt del agente. Es texto de un
                tercero: activalo solo si lo leíste y estás de acuerdo.
              </span>
            </label>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * Permiso del agente
 * ============================================================ */

function AgentCard({
  integration,
  canManage,
  onChanged,
  onError,
}: {
  integration: IntegrationView;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function toggle(value: boolean) {
    setSaving(true);
    onError(null);
    const res = await fetch("/api/integrations/mcp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentToolsEnabled: value }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      onError(messageFromError(await readApiError(res)));
      return;
    }
    await onChanged();
  }

  return (
    <Card data-testid="mcp-agent">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-brand" strokeWidth={1.7} />
          Agente
        </CardTitle>
        <CardDescription>
          Qué puede hacer el agente con este conector.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4 md:px-5 md:pb-5">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={integration.agentToolsEnabled}
            disabled={!canManage || saving}
            onChange={(e) => void toggle(e.target.checked)}
            data-testid="mcp-agent-tools"
          />
          <span>
            El agente puede consultar el sistema de reservas. Si está apagado,
            no consulta nada y deriva al equipo.
          </span>
        </label>
        <p className="rounded-md border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          El agente informa y pasa el enlace. Nunca confirma ni promete una
          reserva.
        </p>
        {!canManage && (
          <p className="text-xs text-muted-foreground">
            Solo el propietario puede cambiar este permiso.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * Búsqueda de prueba — lo mismo que vería el agente
 * ============================================================ */

function PreviewCard({
  integration,
  canManage,
}: {
  integration: IntegrationView;
  canManage: boolean;
}) {
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState(2);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Los valores por defecto se calculan después de montar: si se calcularan
  // durante el render, el HTML del server y el del cliente podrían diferir.
  useEffect(() => {
    setCheckIn((prev) => prev || isoPlusDays(7));
    setCheckOut((prev) => prev || isoPlusDays(9));
  }, []);

  const currency = integration.catalog?.currency ?? "ARS";
  const windowHint = integration.catalog?.window;

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/integrations/mcp/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        check_in: checkIn,
        check_out: checkOut,
        guests,
      }),
    }).catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      const err = await readApiError(res);
      const help = err.providerCode ? PROVIDER_HELP[err.providerCode] : undefined;
      setError(help ?? messageFromError(err));
      return;
    }
    setResult((await res.json()) as PreviewResult);
  }

  const canRun =
    canManage && checkIn !== "" && checkOut !== "" && guests >= 1 && !loading;

  return (
    <Card data-testid="mcp-preview">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-4 w-4 text-brand" strokeWidth={1.7} />
          Búsqueda de prueba
        </CardTitle>
        <CardDescription>
          La misma consulta que hace el agente, con los datos tal como los ve
          él. No le llega a ningún contacto.
          {windowHint
            ? ` El servidor tiene precios publicados entre ${windowHint.from} y ${windowHint.to}.`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-4 md:px-5 md:pb-5">
        <fieldset disabled={!canManage || loading} className="min-w-0 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-check-in">Entrada</Label>
              <Input
                id="mcp-check-in"
                data-testid="mcp-check-in"
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mcp-check-out">Salida</Label>
              <Input
                id="mcp-check-out"
                data-testid="mcp-check-out"
                type="date"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mcp-guests">Huéspedes</Label>
              <Input
                id="mcp-guests"
                data-testid="mcp-guests"
                type="number"
                min={1}
                max={50}
                value={guests}
                onChange={(e) => setGuests(Number(e.target.value))}
              />
            </div>
          </div>
        </fieldset>
        <Button
          onClick={() => void run()}
          disabled={!canRun}
          data-testid="mcp-preview-run"
        >
          {loading ? "Consultando…" : "Probar búsqueda"}
        </Button>
        {!canManage && (
          <p className="text-xs text-muted-foreground">
            Solo el propietario puede correr la búsqueda de prueba.
          </p>
        )}

        {error && (
          <p
            className="rounded-md border border-[#ecd4d2] bg-[#faf1f0] px-3 py-2 text-sm text-[#a2504c]"
            role="alert"
            data-testid="mcp-preview-error"
          >
            {error}
          </p>
        )}

        {result && (
          <div className="space-y-3" data-testid="mcp-preview-result">
            <p className="text-sm">
              <span className="font-medium">
                {result.availableCount} alojamiento
                {result.availableCount === 1 ? "" : "s"} disponible
                {result.availableCount === 1 ? "" : "s"}
              </span>{" "}
              para esas fechas y esa cantidad de huéspedes.
            </p>
            {result.properties.length === 0 && (
              <p className="text-sm text-muted-foreground">
                El servidor no devolvió alojamientos. Probá corriendo las
                fechas, bajando la cantidad de personas o sacando un requisito.
              </p>
            )}
            <ul className="space-y-2">
              {result.properties.map((p) => (
                <li
                  key={p.code}
                  className="rounded-md border p-3 text-sm"
                  data-testid={`mcp-preview-property-${p.code}`}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.code}
                      {p.city ? ` · ${p.city}` : ""}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[
                      p.capacity ? `hasta ${p.capacity} personas` : null,
                      p.bedrooms ? `${p.bedrooms} dorm.` : null,
                      p.bathrooms ? `${p.bathrooms} baños` : null,
                      p.minStay ? `mínimo ${p.minStay} noches` : null,
                    ]
                      .filter((x): x is string => x !== null)
                      .join(" · ")}
                  </p>
                  {p.facilities.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.facilities.join(" · ")}
                    </p>
                  )}
                  {p.pricing && (
                    <p className="mt-1 tabular-nums">
                      {formatMoney(p.pricing.total, p.pricing.currency)} por{" "}
                      {p.pricing.nights} noche
                      {p.pricing.nights === 1 ? "" : "s"}
                      {p.pricing.pricePerNight !== null
                        ? ` · ${formatMoney(p.pricing.pricePerNight, p.pricing.currency)} la noche`
                        : ""}
                      {p.pricing.deposit !== null
                        ? ` · seña ${formatMoney(p.pricing.deposit, p.pricing.currency)}`
                        : ""}
                    </p>
                  )}
                  {p.url && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block break-all text-xs text-brand-text hover:underline"
                    >
                      Ver en el sitio
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {result.searchUrl && (
              <a
                href={result.searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block break-all text-xs text-brand-text hover:underline"
                data-testid="mcp-preview-search-url"
              >
                Abrir esta búsqueda en el sitio
              </a>
            )}
            {result.message && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">
                  Resumen del proveedor (sin verificar):
                </span>{" "}
                {result.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Precios en {currency}, tal como los devuelve el servidor: no se
              convierten ni se recalculan.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * Conflictos con el knowledge base (corrección #55)
 * ============================================================ */

type KbEntryView = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

/**
 * Heurístico de «esto dice un monto» (puro, exportado para test): símbolo de
 * moneda, un número con separador de miles, o un número junto a una palabra
 * de plata. Es deliberadamente generoso: el costo de un falso positivo es que
 * el dueño lea una entrada de más; el de un falso negativo, que el agente
 * responda un precio viejo.
 */
export function containsAmount(text: string): boolean {
  if (!text) return false;
  if (/[$€]\s?\d/.test(text)) return true;
  if (/\b\d{1,3}(?:[.,]\d{3})+\b/.test(text)) return true;
  if (/\b\d+\s?(?:mil|lucas)\b/i.test(text)) return true;
  if (/\b\d[\d.,]*\s?(?:pesos|ars|usd|dólares|dolares|euros)\b/i.test(text))
    return true;
  return false;
}

/** Texto plano de una entrada, para buscar montos y para el resumen. */
export function kbEntryText(entry: KbEntryView): string {
  return entry.kind === "qa"
    ? `${entry.question ?? ""} ${entry.answer ?? ""}`.trim()
    : (entry.content ?? "").trim();
}

function KbConflictCard() {
  const [entries, setEntries] = useState<KbEntryView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/kb").catch(() => null);
      if (!res?.ok) {
        if (!cancelled) setEntries([]);
        return;
      }
      const data = (await res.json()) as { entries: KbEntryView[] };
      if (!cancelled) setEntries(data.entries);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const conflicts = useMemo(
    () => (entries ?? []).filter((e) => containsAmount(kbEntryText(e))),
    [entries]
  );

  if (entries === null || conflicts.length === 0) return null;

  return (
    <Card data-testid="mcp-kb-conflicts">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[#8a6d3b]" strokeWidth={1.7} />
          Precios cargados a mano en el conocimiento
        </CardTitle>
        <CardDescription>
          Con el conector prendido, los precios los consulta el agente en vivo.
          Estas entradas del conocimiento tienen montos escritos a mano y
          compiten con los datos reales: revisalas o borralas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-4 md:px-5 md:pb-5">
        <ul className="space-y-2">
          {conflicts.map((e) => (
            <li
              key={e.id}
              className="rounded-md border p-3 text-sm"
              data-testid={`mcp-kb-conflict-${e.id}`}
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {e.kind === "qa" ? "Pregunta y respuesta" : "Bloque de texto"}
              </p>
              <p className="mt-1 break-words">
                {kbEntryText(e).slice(0, 240)}
                {kbEntryText(e).length > 240 ? "…" : ""}
              </p>
            </li>
          ))}
        </ul>
        <Link
          href="/agent"
          className="inline-flex items-center gap-2 text-sm text-brand-text hover:underline"
        >
          <BookOpen className="h-4 w-4" strokeWidth={1.7} />
          Abrir el conocimiento del agente
        </Link>
      </CardContent>
    </Card>
  );
}
