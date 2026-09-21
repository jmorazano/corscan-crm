"use client";

import { useCallback, useState } from "react";
import { Plug, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Conector MCP en Administración (016, US1 — solo super admin).
 *
 * La URL del servidor MCP la fija ÚNICAMENTE el super admin (FR-001/FR-002):
 * un usuario de empresa no la escribe ni la lee. Y la existencia de la fila
 * ES la habilitación: crearla hace aparecer la tarjeta en esa empresa y en
 * ninguna otra.
 *
 * La credencial se carga acá solo por comodidad (el dueño de la instancia la
 * deja lista); se manda en un campo de tipo password y jamás vuelve: la API
 * solo devuelve `hasCredential` y los últimos 4.
 */

export type McpProfileKey = "generic" | "altos_de_calamuchita";
export type McpAuthScheme = "bearer" | "api_key_header";
export type McpAdminStatus =
  | "enabled"
  | "connected"
  | "reconnect_required"
  | "disabled";

/** Resumen que viaja en `GET /api/admin/organizations` (solo el host). */
export type McpAdminSummary = {
  enabled: boolean;
  profile: McpProfileKey;
  status: McpAdminStatus;
  endpointHost: string;
  /** true si otra empresa de la instancia usa el mismo host (c#23). */
  shared: boolean;
};

/** Vista completa del super admin: acá sí va la `endpointUrl` entera (c#36). */
type McpAdminView = {
  organizationId: string;
  profile: McpProfileKey;
  label: string;
  endpointUrl: string;
  endpointHost: string;
  authScheme: McpAuthScheme;
  status: McpAdminStatus;
  hasCredential: boolean;
  credentialLast4: string | null;
  timezone: string;
  timeoutMs: number;
  maxResponseBytes: number;
  catalogTtlMinutes: number;
  serverName: string | null;
  serverVersion: string | null;
  lastErrorCode: string | null;
  sharedWith: { organizationId: string; name: string }[];
};

type ApiErrorBody = {
  code?: string;
  message?: string;
  reason?: string;
};

const PROFILE_LABEL: Record<McpProfileKey, string> = {
  altos_de_calamuchita: "Altos de Calamuchita (alojamientos)",
  generic: "Servidor MCP genérico (el agente no recibe herramientas)",
};

const AUTH_LABEL: Record<McpAuthScheme, string> = {
  bearer: "Bearer (Authorization: Bearer …)",
  api_key_header: "Clave en encabezado (X-API-Key)",
};

const STATUS_LABEL: Record<
  McpAdminStatus,
  { text: string; variant: "success" | "secondary" | "warning" }
> = {
  connected: { text: "Conectada", variant: "success" },
  enabled: { text: "Sin conectar", variant: "secondary" },
  reconnect_required: { text: "Requiere reconexión", variant: "warning" },
  disabled: { text: "Deshabilitada", variant: "secondary" },
};

/** Traducción de cada `reason` del 422 `invalid_endpoint` (texto propio). */
const REASON_TEXT: Record<string, string> = {
  not_https: "La dirección debe empezar con https://.",
  userinfo: "La dirección no puede llevar usuario y contraseña (user:pass@).",
  bad_port: "Solo se permite el puerto 443.",
  ip_literal: "No se permite una IP literal: usá un nombre de dominio.",
  bad_host: "El nombre de dominio no es válido.",
  too_long: "La dirección es demasiado larga.",
  blocked_host: "Esa dirección apunta a una red interna y no se permite.",
  unresolvable: "El dominio no resuelve. Revisá que esté bien escrito.",
};

const DEFAULTS = {
  timezone: "America/Argentina/Cordoba",
  timeoutMs: 10000,
  maxResponseBytes: 524288,
  catalogTtlMinutes: 60,
};

type FormState = {
  profile: McpProfileKey;
  label: string;
  endpointUrl: string;
  authScheme: McpAuthScheme;
  credential: string;
  timezone: string;
  timeoutMs: number;
  maxResponseBytes: number;
  catalogTtlMinutes: number;
};

function emptyForm(organizationName: string): FormState {
  return {
    profile: "altos_de_calamuchita",
    label: `${organizationName} (reservas)`.slice(0, 80),
    endpointUrl: "",
    authScheme: "bearer",
    credential: "",
    timezone: DEFAULTS.timezone,
    timeoutMs: DEFAULTS.timeoutMs,
    maxResponseBytes: DEFAULTS.maxResponseBytes,
    catalogTtlMinutes: DEFAULTS.catalogTtlMinutes,
  };
}

export function McpAdminCard({
  organizationId,
  organizationName,
  mcp,
  onChanged,
}: {
  organizationId: string;
  organizationName: string;
  mcp: McpAdminSummary | null | undefined;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(organizationName));
  const [detail, setDetail] = useState<McpAdminView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const enabled = mcp?.enabled === true;
  const status = mcp ? STATUS_LABEL[mcp.status] : null;

  const patch = useCallback(
    (values: Partial<FormState>) => setForm((prev) => ({ ...prev, ...values })),
    []
  );

  /**
   * Abre el formulario. Para editar necesita la `endpointUrl` completa, que
   * solo viaja en el detalle; si ese endpoint no responde, se abre vacío con
   * el aviso de volver a pegar la dirección (nunca se inventa una URL).
   */
  async function openForm() {
    setError(null);
    setDetail(null);
    // Con fila (aunque esté deshabilitada) se precarga del detalle; sin fila
    // se abre en blanco.
    if (!mcp) {
      setForm(emptyForm(organizationName));
      setOpen(true);
      return;
    }
    setBusy(true);
    const res = await fetch(
      `/api/admin/organizations/${organizationId}/mcp`
    ).catch(() => null);
    setBusy(false);
    const body = res?.ok
      ? ((await res.json().catch(() => null)) as {
          integration?: McpAdminView;
        } | null)
      : null;
    const view = body?.integration ?? null;
    setDetail(view);
    setForm({
      profile: view?.profile ?? mcp.profile ?? "altos_de_calamuchita",
      label: view?.label ?? "",
      endpointUrl: view?.endpointUrl ?? "",
      authScheme: view?.authScheme ?? "bearer",
      credential: "",
      timezone: view?.timezone ?? DEFAULTS.timezone,
      timeoutMs: view?.timeoutMs ?? DEFAULTS.timeoutMs,
      maxResponseBytes: view?.maxResponseBytes ?? DEFAULTS.maxResponseBytes,
      catalogTtlMinutes: view?.catalogTtlMinutes ?? DEFAULTS.catalogTtlMinutes,
    });
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      profile: form.profile,
      label: form.label.trim(),
      endpointUrl: form.endpointUrl.trim(),
      authScheme: form.authScheme,
      timezone: form.timezone.trim(),
      timeoutMs: form.timeoutMs,
      maxResponseBytes: form.maxResponseBytes,
      catalogTtlMinutes: form.catalogTtlMinutes,
    };
    if (form.credential.trim().length >= 8) {
      payload.credential = form.credential.trim();
    }
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
      const reasonText = err.reason ? REASON_TEXT[err.reason] : undefined;
      setError(
        reasonText ?? err.message ?? "No se pudo guardar el conector."
      );
      return;
    }
    const body = (await res.json().catch(() => null)) as {
      integration?: McpAdminView;
    } | null;
    setDetail(body?.integration ?? null);
    setOpen(false);
    setForm((prev) => ({ ...prev, credential: "" }));
    await onChanged();
  }

  async function disable() {
    if (
      !window.confirm(
        `¿Deshabilitar el conector MCP de ${organizationName}? Se borra la credencial y la tarjeta desaparece de esa empresa. El catálogo y el historial se conservan.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/admin/organizations/${organizationId}/mcp?mode=disable`,
      { method: "DELETE" }
    ).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError("No se pudo deshabilitar el conector.");
      return;
    }
    await onChanged();
  }

  const sharedNames = detail?.sharedWith ?? [];

  return (
    <div
      className="space-y-3 rounded-md border p-3"
      data-testid={`admin-mcp-${organizationId}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Plug className="h-4 w-4 text-brand" strokeWidth={1.7} />
        <p className="text-sm font-medium">Conector MCP</p>
        {status && <Badge variant={status.variant}>{status.text}</Badge>}
        {mcp?.shared && (
          <Badge variant="warning">Endpoint compartido</Badge>
        )}
      </div>

      {enabled && mcp ? (
        <p className="break-all text-xs text-muted-foreground">
          {PROFILE_LABEL[mcp.profile]} · {mcp.endpointHost}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Sin conector. Habilitarlo hace aparecer la tarjeta en esta empresa y
          en ninguna otra.
        </p>
      )}

      {mcp?.shared && (
        <p className="rounded-md border border-[#ece2cf] bg-[#faf7f0] px-3 py-2 text-xs text-[#8a6d3b]">
          <ShieldAlert className="mr-1 inline h-3.5 w-3.5" strokeWidth={1.7} />
          Otra empresa de esta instancia apunta al mismo servidor. Si además
          comparten la credencial, comparten la atribución de los contactos que
          llegan por ese sistema.
        </p>
      )}

      {sharedNames.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Mismo servidor que: {sharedNames.map((s) => s.name).join(", ")}.
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {open ? (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`admin-mcp-profile-${organizationId}`}>
                Perfil del proveedor
              </Label>
              <select
                id={`admin-mcp-profile-${organizationId}`}
                className="flex h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm md:h-9"
                value={form.profile}
                onChange={(e) =>
                  patch({ profile: e.target.value as McpProfileKey })
                }
              >
                <option value="altos_de_calamuchita">
                  {PROFILE_LABEL.altos_de_calamuchita}
                </option>
                <option value="generic">{PROFILE_LABEL.generic}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`admin-mcp-label-${organizationId}`}>
                Etiqueta visible
              </Label>
              <Input
                id={`admin-mcp-label-${organizationId}`}
                value={form.label}
                maxLength={80}
                onChange={(e) => patch({ label: e.target.value })}
                placeholder="Altos de Calamuchita (reservas)"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`admin-mcp-url-${organizationId}`}>
              Dirección del servidor MCP
            </Label>
            <Input
              id={`admin-mcp-url-${organizationId}`}
              data-testid={`admin-mcp-url-${organizationId}`}
              value={form.endpointUrl}
              onChange={(e) => patch({ endpointUrl: e.target.value })}
              placeholder="https://proveedor.example.com/mcp/assistant"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-[#a2504c]">
              Cambiar la dirección borra la credencial cargada: hay que volver a
              pegarla.
            </p>
            {mcp && detail === null && (
              <p className="text-xs text-muted-foreground">
                No se pudo precargar la dirección guardada: pegala completa otra
                vez antes de guardar.
              </p>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`admin-mcp-auth-${organizationId}`}>
                Forma de autenticación
              </Label>
              <select
                id={`admin-mcp-auth-${organizationId}`}
                className="flex h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm md:h-9"
                value={form.authScheme}
                onChange={(e) =>
                  patch({ authScheme: e.target.value as McpAuthScheme })
                }
              >
                <option value="bearer">{AUTH_LABEL.bearer}</option>
                <option value="api_key_header">
                  {AUTH_LABEL.api_key_header}
                </option>
              </select>
              <p className="text-xs text-muted-foreground">
                Cambiarla también borra la credencial cargada.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`admin-mcp-credential-${organizationId}`}>
                Credencial (opcional)
              </Label>
              <Input
                id={`admin-mcp-credential-${organizationId}`}
                data-testid={`admin-mcp-credential-${organizationId}`}
                type="password"
                autoComplete="off"
                value={form.credential}
                onChange={(e) => patch({ credential: e.target.value })}
                placeholder={
                  detail?.hasCredential
                    ? `Cargada (••••${detail.credentialLast4 ?? ""}) — dejar vacío para no tocarla`
                    : "La puede cargar después el propietario de la empresa"
                }
              />
              <p className="text-xs text-muted-foreground">
                Se guarda cifrada y no se vuelve a mostrar.
              </p>
            </div>
          </div>

          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm">
              Ajustes avanzados
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`admin-mcp-tz-${organizationId}`}>
                  Zona horaria del negocio
                </Label>
                <Input
                  id={`admin-mcp-tz-${organizationId}`}
                  value={form.timezone}
                  onChange={(e) => patch({ timezone: e.target.value })}
                  placeholder={DEFAULTS.timezone}
                />
                <p className="text-xs text-muted-foreground">
                  Define qué día es «hoy» para el agente cuando el cliente dice
                  «mañana».
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`admin-mcp-timeout-${organizationId}`}>
                  Tiempo máximo de espera (ms)
                </Label>
                <Input
                  id={`admin-mcp-timeout-${organizationId}`}
                  type="number"
                  min={2000}
                  max={30000}
                  value={form.timeoutMs}
                  onChange={(e) => patch({ timeoutMs: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`admin-mcp-bytes-${organizationId}`}>
                  Respuesta máxima (bytes)
                </Label>
                <Input
                  id={`admin-mcp-bytes-${organizationId}`}
                  type="number"
                  min={16384}
                  max={4194304}
                  value={form.maxResponseBytes}
                  onChange={(e) =>
                    patch({ maxResponseBytes: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`admin-mcp-ttl-${organizationId}`}>
                  Vigencia del catálogo (minutos)
                </Label>
                <Input
                  id={`admin-mcp-ttl-${organizationId}`}
                  type="number"
                  min={5}
                  max={1440}
                  value={form.catalogTtlMinutes}
                  onChange={(e) =>
                    patch({ catalogTtlMinutes: Number(e.target.value) })
                  }
                />
              </div>
            </div>
          </details>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                saving ||
                form.label.trim().length < 2 ||
                form.endpointUrl.trim().length < 8
              }
              onClick={() => void save()}
              data-testid={`admin-mcp-save-${organizationId}`}
            >
              {saving ? "Guardando…" : enabled ? "Guardar cambios" : "Habilitar conector"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void openForm()}
            data-testid={`admin-mcp-open-${organizationId}`}
          >
            <Plug className="h-3.5 w-3.5" strokeWidth={1.7} />
            {enabled ? "Editar" : "Habilitar conector"}
          </Button>
          {enabled && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void disable()}
              data-testid={`admin-mcp-disable-${organizationId}`}
            >
              Deshabilitar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
