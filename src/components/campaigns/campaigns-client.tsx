"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Megaphone,
  Pause,
  Play,
  Plus,
  XCircle,
} from "lucide-react";
import type { TemplateDto } from "@/lib/types";
import { formatPhone } from "@/lib/utils";
import { useEvents } from "@/components/use-events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Campañas (004, US4). Lista con progreso en vivo (SSE campaign.progress +
 * catch-up por refetch), creación con vista previa del segmento elegible, y
 * detalle con tracking por destinatario.
 */

type Counts = {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  failed: number;
  skipped: number;
};

type CampaignListItem = {
  id: string;
  name: string;
  status: string;
  pausedReason: string | null;
  templateName: string;
  tagFilter: string[];
  launchedAt: string | null;
  counts: Counts;
};

type RecipientRow = {
  contactId: string;
  name: string;
  phone: string;
  status: string;
  deliveryStatus: string | null;
  error: string | null;
  skipReason: string | null;
  repliedAt: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  running: "En curso",
  paused: "Pausada",
  completed: "Completada",
  cancelled: "Cancelada",
};

const PAUSE_LABELS: Record<string, string> = {
  manual: "por el operador",
  daily_limit: "por cupo de 24h (reanuda sola)",
  channel: "por el canal (revisá plantilla/conexión)",
  error: "por un error interno (reanudala para reintentar)",
};

export function CampaignsClient() {
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/campaigns").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { campaigns: CampaignListItem[] };
    setCampaigns(data.campaigns);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEvents({
    onCampaignProgress: () => void refetch(),
    onReconnect: () => void refetch(),
  });

  if (selectedId) {
    return (
      <CampaignDetail
        campaignId={selectedId}
        onBack={() => {
          setSelectedId(null);
          void refetch();
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <h2 className="font-semibold">Campañas</h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Nueva campaña
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {campaigns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Megaphone className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Sin campañas</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Una campaña envía una plantilla aprobada a un segmento de tus
              contactos con consentimiento, de a poco y respetando el cupo
              del canal. Importá tu lista en Contactos y creá la primera.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {campaigns.map((c) => (
              <li
                key={c.id}
                className="cursor-pointer rounded-lg border bg-card px-4 py-3 hover:border-primary/50"
                onClick={() => setSelectedId(c.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.name}
                    </span>
                    <StatusBadge status={c.status} pausedReason={c.pausedReason} />
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {c.templateName}
                    {c.tagFilter.length > 0 && ` · #${c.tagFilter.join(" #")}`}
                  </span>
                </div>
                {c.counts.total > 0 && (
                  <CountsBar counts={c.counts} className="mt-2" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating && (
        <NewCampaignDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            void refetch();
            setSelectedId(id);
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({
  status,
  pausedReason,
}: {
  status: string;
  pausedReason: string | null;
}) {
  const variant =
    status === "running"
      ? "default"
      : status === "paused"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={variant}>
      {STATUS_LABELS[status] ?? status}
      {status === "paused" && pausedReason
        ? ` ${PAUSE_LABELS[pausedReason] ?? ""}`
        : ""}
    </Badge>
  );
}

function CountsBar({
  counts,
  className,
}: {
  counts: Counts;
  className?: string;
}) {
  const parts: { label: string; value: number; tone?: string }[] = [
    { label: "pendientes", value: counts.pending },
    { label: "enviados", value: counts.sent },
    { label: "entregados", value: counts.delivered },
    { label: "leídos", value: counts.read },
    { label: "respondieron", value: counts.replied, tone: "text-primary" },
    { label: "fallidos", value: counts.failed, tone: "text-destructive" },
    { label: "omitidos", value: counts.skipped },
  ];
  return (
    <p className={`text-xs text-muted-foreground ${className ?? ""}`}>
      {counts.total} destinatarios
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span key={p.label} className={p.tone}>
            {" "}
            · {p.value} {p.label}
          </span>
        ))}
    </p>
  );
}

function NewCampaignDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [tags, setTags] = useState("");
  const [variableMode, setVariableMode] = useState<"contact_name" | "fixed">(
    "contact_name"
  );
  const [variableText, setVariableText] = useState("");
  const [eligible, setEligible] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: TemplateDto[] }) =>
        setTemplates((d.templates ?? []).filter((t) => t.status === "approved"))
      )
      .catch(() => setTemplates([]));
  }, []);

  // Vista previa del segmento elegible (FR-013), con debounce.
  useEffect(() => {
    const t = setTimeout(() => {
      const clean = tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(",");
      fetch(`/api/campaigns/segment-preview?tags=${encodeURIComponent(clean)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { eligible: number } | null) =>
          setEligible(d?.eligible ?? null)
        )
        .catch(() => setEligible(null));
    }, 300);
    return () => clearTimeout(t);
  }, [tags]);

  const selected = templates?.find((t) => t.id === templateId) ?? null;
  const needsVariable = selected
    ? /\{\{\s*1\s*\}\}/.test(selected.body)
    : false;

  async function create() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        templateId,
        tagFilter: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        variableMode,
        variableText: variableMode === "fixed" ? variableText : undefined,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear la campaña.");
      return;
    }
    const data = (await res.json()) as { id: string };
    onCreated(data.id);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-semibold">Nueva campaña</h3>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="cmp-name">
              Nombre
            </label>
            <Input
              id="cmp-name"
              placeholder="Promo primavera"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="cmp-template">
              Plantilla aprobada
            </label>
            <select
              id="cmp-template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Elige una plantilla…</option>
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
            {templates !== null && templates.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay plantillas aprobadas todavía (Ajustes → Plantillas).
              </p>
            )}
          </div>
          {selected && (
            <p className="rounded-md bg-secondary/60 p-2.5 text-xs text-muted-foreground">
              {selected.body}
            </p>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="cmp-tags">
              Segmento por etiquetas (vacío = todos los elegibles)
            </label>
            <Input
              id="cmp-tags"
              placeholder="clientes-2025, vip"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            {eligible !== null && (
              <p
                className={`text-xs ${eligible === 0 ? "text-destructive" : "text-muted-foreground"}`}
              >
                {eligible} contacto(s) elegible(s) hoy (con consentimiento,
                sin baja)
              </p>
            )}
          </div>
          {needsVariable && (
            <div className="space-y-1.5">
              <span className="text-sm font-medium">
                La plantilla tiene {"{{1}}"} — completar con:
              </span>
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={variableMode === "contact_name"}
                    onChange={() => setVariableMode("contact_name")}
                    className="accent-primary"
                  />
                  el nombre del contacto
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={variableMode === "fixed"}
                    onChange={() => setVariableMode("fixed")}
                    className="accent-primary"
                  />
                  un texto fijo
                </label>
              </div>
              {variableMode === "fixed" && (
                <Input
                  placeholder="texto para {{1}}"
                  value={variableText}
                  onChange={(e) => setVariableText(e.target.value)}
                />
              )}
            </div>
          )}
        </div>
        {error && (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            disabled={
              !name.trim() ||
              !templateId ||
              saving ||
              (needsVariable && variableMode === "fixed" && !variableText.trim())
            }
            onClick={() => void create()}
          >
            {saving ? "Creando…" : "Crear borrador"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type CampaignDetailData = {
  campaign: {
    id: string;
    name: string;
    status: string;
    pausedReason: string | null;
    templateName: string;
    tagFilter: string[];
    launchedAt: string | null;
  };
  counts: Counts;
  recipients: RecipientRow[];
  nextCursor: string | null;
};

function CampaignDetail({
  campaignId,
  onBack,
}: {
  campaignId: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<CampaignDetailData | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}`).catch(() => null);
    if (!res?.ok) return;
    setData((await res.json()) as CampaignDetailData);
  }, [campaignId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEvents({
    onCampaignProgress: (d) => {
      if (d.campaignId === campaignId) void refetch();
    },
    onReconnect: () => void refetch(),
  });

  async function act(action: "launch" | "pause" | "resume" | "cancel") {
    setWorking(true);
    setError(null);
    setConfirmingCancel(false);
    const res = await fetch(`/api/campaigns/${campaignId}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    setWorking(false);
    if (!res?.ok) {
      const d = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(d?.error?.message ?? "La acción falló.");
    }
    void refetch();
  }

  if (!data) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Cargando campaña…</div>
    );
  }
  const { campaign, counts } = data;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Volver">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="truncate font-semibold">{campaign.name}</h2>
          <StatusBadge
            status={campaign.status}
            pausedReason={campaign.pausedReason}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {campaign.status === "draft" && (
            <Button size="sm" disabled={working} onClick={() => void act("launch")}>
              <Play className="mr-1.5 h-4 w-4" />
              Lanzar
            </Button>
          )}
          {(campaign.status === "running" ||
            (campaign.status === "paused" &&
              campaign.pausedReason !== "manual")) && (
            <Button
              variant="outline"
              size="sm"
              disabled={working}
              onClick={() => void act("pause")}
            >
              <Pause className="mr-1.5 h-4 w-4" />
              Pausar
            </Button>
          )}
          {campaign.status === "paused" && (
            <Button size="sm" disabled={working} onClick={() => void act("resume")}>
              <Play className="mr-1.5 h-4 w-4" />
              Reanudar
            </Button>
          )}
          {(campaign.status === "running" || campaign.status === "paused") &&
            (confirmingCancel ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={working}
                  onClick={() => void act("cancel")}
                >
                  Confirmar cancelación
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingCancel(false)}
                >
                  No
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={working}
                onClick={() => setConfirmingCancel(true)}
              >
                <XCircle className="mr-1.5 h-4 w-4" />
                Cancelar
              </Button>
            ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mb-4 rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Plantilla <span className="font-medium">{campaign.templateName}</span>
            {campaign.tagFilter.length > 0 &&
              ` · segmento #${campaign.tagFilter.join(" #")}`}
            {campaign.launchedAt &&
              ` · lanzada ${new Date(campaign.launchedAt).toLocaleString()}`}
          </p>
          <CountsBar counts={counts} className="mt-1" />
          {counts.total > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: `${Math.round(((counts.total - counts.pending) / counts.total) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>

        {data.recipients.length > 0 && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-card text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-normal">Contacto</th>
                  <th className="px-3 py-2 font-normal">Estado</th>
                  <th className="px-3 py-2 font-normal">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {data.recipients.map((r) => (
                  <tr key={r.contactId} className="border-t">
                    <td className="px-3 py-2">
                      {r.name}{" "}
                      <span className="text-muted-foreground">
                        {formatPhone(r.phone)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <RecipientStatus r={r} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.error ?? (r.skipReason ? SKIP_LABELS[r.skipReason] : "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.nextCursor && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Mostrando los primeros {data.recipients.length} destinatarios.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const SKIP_LABELS: Record<string, string> = {
  opted_out: "dado de baja",
  ineligible: "inelegible",
  cancelled: "campaña cancelada",
};

function RecipientStatus({ r }: { r: RecipientRow }) {
  if (r.repliedAt) return <span className="text-primary">respondió</span>;
  if (r.status === "sent") {
    if (r.deliveryStatus === "failed")
      return <span className="text-destructive">falló la entrega</span>;
    if (r.deliveryStatus === "read") return <span>leído ✓✓</span>;
    if (r.deliveryStatus === "delivered") return <span>entregado ✓✓</span>;
    return <span>enviado ✓</span>;
  }
  if (r.status === "failed")
    return <span className="text-destructive">fallido</span>;
  if (r.status === "skipped")
    return <span className="text-muted-foreground">omitido</span>;
  if (r.status === "sending") return <span>enviando…</span>;
  return <span className="text-muted-foreground">pendiente</span>;
}
