"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Building2, ExternalLink, Link2, RefreshCw, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Página de la integración Mercado Libre (025): conexión OAuth, estado de la
 * sincronización, el ajuste «el agente ofrece estas publicaciones» y la
 * lista de lo que el agente ve. Solo el propietario administra; jamás se
 * muestra un token.
 */

type SyncStatus = "idle" | "running" | "ok" | "failed";

type Integration = {
  nickname: string | null;
  siteId: string;
  status: "connected" | "reconnect_required";
  agentEnabled: boolean;
  connectedAt: string;
  sync: { status: SyncStatus; lastSyncAt: string | null; lastError: string | null; count: number };
};

type ListingView = {
  itemId: string;
  title: string;
  operation: string | null;
  propertyType: string | null;
  price: string | null;
  zone: string | null;
  bedrooms: number | null;
  rooms: number | null;
  permalink: string | null;
  thumbnail: string | null;
};

type Data = {
  available: boolean;
  integration: Integration | null;
  canManage: boolean;
  listings: ListingView[];
  totalListings: number;
};

const ERROR_TEXT: Record<string, string> = {
  cancelled: "Cancelaste la autorización en Mercado Libre. No se conectó nada.",
  state: "La autorización no coincide con tu sesión. Volvé a intentar desde este botón.",
  exchange:
    "Mercado Libre no completó la autorización. Entrá con la cuenta PRINCIPAL (no un colaborador) e intentá de nuevo.",
  forbidden: "Solo el propietario puede conectar la integración.",
  account_in_use:
    "Esa cuenta de Mercado Libre ya está conectada en otra empresa de esta instancia. Desconectala allá primero.",
};

const SYNC_ERROR_TEXT: Record<string, string> = {
  reconnect_required: "Mercado Libre rechazó la credencial guardada: volvé a conectar la cuenta.",
  unauthorized: "Mercado Libre rechazó el acceso: volvé a conectar la cuenta.",
  forbidden: "Mercado Libre denegó el acceso a las publicaciones de la cuenta.",
  rate_limited: "Mercado Libre limitó los pedidos. Probá de nuevo en unos minutos.",
  timeout: "Mercado Libre tardó demasiado en responder. Probá de nuevo en un rato.",
  provider_error: "Mercado Libre respondió con un error. Probá de nuevo en un rato.",
  interrupted: "La última sincronización se interrumpió. Volvé a sincronizar.",
  truncated: "La cuenta tiene más de 1.000 publicaciones activas: el agente ve las primeras 1.000.",
  internal_error: "No se pudo sincronizar. Probá de nuevo en un rato.",
};

function when(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(iso);
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

export function MercadoLibreClient() {
  const params = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/integrations/mercadolibre").catch(() => null);
    if (!res?.ok) return;
    const next = (await res.json()) as Data;
    setData(next);
    // Mientras la sync corre, la página se refresca sola.
    if (poll.current) clearTimeout(poll.current);
    if (next.integration?.sync.status === "running") {
      poll.current = setTimeout(() => void refetch(), 2000);
    }
  }, []);

  useEffect(() => {
    void refetch();
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, [refetch]);

  useEffect(() => {
    if (params.get("connected") === "1") {
      setNotice("Mercado Libre conectado. Estamos trayendo tus publicaciones vigentes…");
    }
    const e = params.get("error");
    if (e) setError(ERROR_TEXT[e] ?? "No se pudo conectar.");
  }, [params]);

  if (!data) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  return (
    <div className="max-w-3xl space-y-6">
      {notice && (
        <p className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] px-3 py-2 text-sm text-[#3f6b52]" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-[#ecd4d2] bg-[#faf1f0] px-3 py-2 text-sm text-[#a2504c]" role="alert">
          {error}
        </p>
      )}
      <ConnectionCard data={data} onChanged={refetch} onError={setError} onNotice={setNotice} />
      {data.integration && (
        <>
          <AgentCard data={data} onChanged={refetch} onError={setError} />
          <ListingsCard data={data} onChanged={refetch} onError={setError} onNotice={setNotice} />
        </>
      )}
    </div>
  );
}

function ConnectionCard({
  data,
  onChanged,
  onError,
  onNotice,
}: {
  data: Data;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const { available, integration, canManage } = data;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function disconnect() {
    setBusy(true);
    onError(null);
    const res = await fetch("/api/integrations/mercadolibre", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!res?.ok) {
      onError("No se pudo desconectar.");
      return;
    }
    onNotice("Mercado Libre desconectado. El agente ya no ofrece tus publicaciones.");
    await onChanged();
  }

  return (
    <Card data-testid="meli-connection">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-brand" strokeWidth={1.7} />
            Conexión
          </CardTitle>
          {!available ? (
            <Badge variant="secondary">No habilitada</Badge>
          ) : !integration ? (
            <Badge variant="secondary">No conectada</Badge>
          ) : integration.status === "reconnect_required" ? (
            <Badge variant="warning">Requiere reconexión</Badge>
          ) : (
            <Badge variant="success">Conectada</Badge>
          )}
        </div>
        <CardDescription>
          {!available
            ? "El operador de esta instancia todavía no habilitó Mercado Libre (faltan las credenciales de la app en el entorno). Pedile que siga docs/integraciones/mercadolibre.md."
            : integration
              ? `Cuenta: ${integration.nickname ?? "(sin apodo)"} · Conectada el ${when(integration.connectedAt)}`
              : "Conectá la cuenta de Mercado Libre donde publicás. Solo pedimos permiso de LECTURA: el CRM no publica, no edita y no responde preguntas."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 px-5 pb-5">
        {available && canManage && (
          <>
            {(!integration || integration.status === "reconnect_required") && (
              <a href="/api/integrations/mercadolibre/connect" data-testid="meli-connect">
                <Button>
                  <Link2 className="h-4 w-4" strokeWidth={1.7} />
                  {integration ? "Reconectar con Mercado Libre" : "Conectar con Mercado Libre"}
                </Button>
              </a>
            )}
            {integration && !confirming && (
              <Button variant="outline" onClick={() => setConfirming(true)} data-testid="meli-disconnect">
                <Unplug className="h-4 w-4" strokeWidth={1.7} />
                Desconectar
              </Button>
            )}
            {integration && confirming && (
              <span className="flex flex-wrap items-center gap-2 text-sm md:flex-nowrap">
                ¿Desconectar? El CRM olvida la credencial y las publicaciones, y el agente deja de ofrecerlas.
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={disconnect}
                  data-testid="meli-disconnect-confirm"
                >
                  Sí, desconectar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Cancelar
                </Button>
              </span>
            )}
          </>
        )}
        {available && !canManage && (
          <p className="text-xs text-muted-foreground">Solo el propietario puede conectar o desconectar.</p>
        )}
        {integration?.status === "reconnect_required" && (
          <p className="w-full text-xs text-[#8a6d3b]" data-testid="meli-reconnect-hint">
            Mercado Libre rechazó la credencial guardada (revocada, vencida o cambiaste la contraseña). El
            agente sigue usando las últimas publicaciones que se trajeron hasta que reconectes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AgentCard({
  data,
  onChanged,
  onError,
}: {
  data: Data;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const integration = data.integration!;
  const enabled = integration.agentEnabled;
  async function toggle() {
    onError(null);
    const res = await fetch("/api/integrations/mercadolibre", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentEnabled: !enabled }),
    }).catch(() => null);
    if (!res?.ok) onError("No se pudo guardar el ajuste.");
    await onChanged();
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>El agente ofrece estas publicaciones</CardTitle>
            <CardDescription>
              Busca entre tus publicaciones vigentes según lo que pide cada cliente, le pasa hasta 3
              opciones con precio y enlace, y cuando quiere ver una anota el pedido de visita y te lo
              deja para que confirmes el horario. Nunca inventa propiedades ni da la dirección exacta.
            </CardDescription>
          </div>
          <button
            role="switch"
            aria-checked={enabled}
            aria-label="El agente ofrece estas publicaciones"
            data-testid="meli-agent-switch"
            disabled={!data.canManage}
            onClick={() => void toggle()}
            className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
              enabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </CardHeader>
    </Card>
  );
}

function ListingsCard({
  data,
  onChanged,
  onError,
  onNotice,
}: {
  data: Data;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const integration = data.integration!;
  const { sync } = integration;
  const running = sync.status === "running";

  async function syncNow() {
    onError(null);
    const res = await fetch("/api/integrations/mercadolibre/sync", { method: "POST" }).catch(() => null);
    if (!res || res.status !== 202) {
      const body = res ? ((await res.json().catch(() => null)) as { error?: { message?: string } } | null) : null;
      onError(body?.error?.message ?? "No se pudo iniciar la sincronización.");
      return;
    }
    onNotice("Sincronizando tus publicaciones…");
    await onChanged();
  }

  return (
    <Card data-testid="meli-listings">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Publicaciones vigentes ({data.totalListings})</CardTitle>
          {data.canManage && (
            <Button
              size="sm"
              variant="outline"
              disabled={running || integration.status === "reconnect_required"}
              onClick={() => void syncNow()}
              data-testid="meli-sync"
            >
              <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} strokeWidth={1.7} />
              {running ? "Sincronizando…" : "Sincronizar ahora"}
            </Button>
          )}
        </div>
        <CardDescription data-testid="meli-sync-state">
          {running
            ? "Trayendo las publicaciones activas de Mercado Libre…"
            : `Última sincronización: ${when(sync.lastSyncAt)} · se actualiza sola cada pocas horas`}
        </CardDescription>
        {sync.status === "failed" && sync.lastError && (
          <p className="text-xs text-[#a2504c]" role="alert" data-testid="meli-sync-error">
            {SYNC_ERROR_TEXT[sync.lastError] ?? SYNC_ERROR_TEXT.internal_error}
          </p>
        )}
        {sync.status === "ok" && sync.lastError === "truncated" && (
          <p className="text-xs text-[#8a6d3b]">{SYNC_ERROR_TEXT.truncated}</p>
        )}
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {data.listings.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="meli-empty">
            {sync.lastSyncAt
              ? "La cuenta no tiene publicaciones activas en este momento."
              : "Todavía no se trajeron publicaciones."}
          </p>
        ) : (
          <ul className="divide-y" data-testid="meli-listing-list">
            {data.listings.map((l) => (
              <li key={l.itemId} className="flex min-w-0 items-start gap-3 py-3" data-testid="meli-listing">
                {l.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.thumbnail}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-md object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded-md bg-secondary" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {[l.operation, l.propertyType, l.zone].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-xs">
                    <span className="font-medium">{l.price ?? "Precio a consultar"}</span>
                    {l.bedrooms !== null && ` · ${l.bedrooms} dorm`}
                    {l.rooms !== null && ` · ${l.rooms} amb`}
                    <span className="text-muted-foreground"> · {l.itemId}</span>
                  </p>
                </div>
                {l.permalink && (
                  <a
                    href={l.permalink}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="shrink-0 text-muted-foreground hover:text-brand"
                    aria-label={`Ver ${l.title} en Mercado Libre`}
                  >
                    <ExternalLink className="h-4 w-4" strokeWidth={1.7} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
