"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Megaphone,
  Pause,
  Play,
  Plus,
  Search,
  Tag,
  Trash2,
  XCircle,
} from "lucide-react";
import type { TemplateDto } from "@/lib/types";
import { cn, formatPhone } from "@/lib/utils";
import { sanitizeTags } from "@/lib/tags";
import { useEvents } from "@/components/use-events";
import { useQueryFilters } from "@/components/use-query-filters";
import { TagChip } from "@/components/tags/tag-chip";
import { TagPicker } from "@/components/tags/tag-picker";
import { TemplatePreview } from "@/components/templates/template-preview";
import { useTagFacets } from "@/components/tags/use-tag-facets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Campañas (004 US4 + 007 gestión). Lista filtrable (estado y búsqueda en la
 * URL), acciones por fila con confirmación, panel «cómo funciona» con el
 * ritmo y el cupo reales, y detalle con el ciclo de vida explicado paso a
 * paso. Progreso en vivo por SSE (campaign.progress) + catch-up por refetch.
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

type Settings = {
  paceMs: number;
  dailyInitiatedLimit: number;
  usedLast24h: number;
  available: number;
};

type CampaignListItem = {
  id: string;
  name: string;
  status: string;
  pausedReason: string | null;
  templateName: string;
  tagFilter: string[];
  createdAt: string;
  launchedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  eligibleNow: number | null;
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

type Action = "launch" | "pause" | "resume" | "cancel" | "delete";

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  running: "En curso",
  paused: "Pausada",
  completed: "Completada",
  cancelled: "Cancelada",
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "draft", label: "Borradores" },
  { value: "running", label: "En curso" },
  { value: "paused", label: "Pausadas" },
  { value: "completed", label: "Completadas" },
  { value: "cancelled", label: "Canceladas" },
];

const PAUSE_LABELS: Record<string, string> = {
  manual: "por vos",
  daily_limit: "por cupo de 24h · reanuda sola",
  channel: "por el canal · revisá plantilla/conexión",
  error: "por un error · reanudala para reintentar",
};

const SKIP_LABELS: Record<string, string> = {
  opted_out: "dado de baja",
  ineligible: "inelegible",
  cancelled: "campaña cancelada",
};

const HELP_KEY = "vocero.campaigns.help";

function canDelete(status: string): boolean {
  return status === "draft" || status === "completed" || status === "cancelled";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return "menos de 1 s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function runAction(
  campaignId: string,
  action: Action
): Promise<{ ok: true } | { ok: false; message: string }> {
  const res =
    action === "delete"
      ? await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" }).catch(
          () => null
        )
      : await fetch(`/api/campaigns/${campaignId}/actions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        }).catch(() => null);
  if (res?.ok) return { ok: true };
  const d = (await res?.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return { ok: false, message: d?.error?.message ?? "La acción falló." };
}

/* ------------------------------------------------------------------ */
/* Lista                                                               */
/* ------------------------------------------------------------------ */

export function CampaignsClient() {
  const { params, set } = useQueryFilters();
  const selectedId = params.get("campaign");
  const statusFilter = params.get("status") ?? "";
  const q = params.get("q") ?? "";

  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);

  const refetch = useCallback(async () => {
    const qs = new URLSearchParams();
    if (statusFilter) qs.set("status", statusFilter);
    if (q) qs.set("q", q);
    const res = await fetch(`/api/campaigns${qs.size ? `?${qs}` : ""}`).catch(
      () => null
    );
    if (!res?.ok) return;
    const data = (await res.json()) as {
      campaigns: CampaignListItem[];
      settings: Settings;
    };
    setCampaigns(data.campaigns);
    setSettings(data.settings);
  }, [statusFilter, q]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Búsqueda con debounce → URL (q=).
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim() !== q) set({ q: search.trim() || null });
    }, 300);
    return () => clearTimeout(t);
  }, [search, q, set]);

  useEvents({
    onCampaignProgress: () => void refetch(),
    onReconnect: () => void refetch(),
  });

  async function act(c: CampaignListItem, action: Action) {
    setError(null);
    const result = await runAction(c.id, action);
    if (!result.ok) setError(`${c.name}: ${result.message}`);
    void refetch();
  }

  if (selectedId) {
    return (
      <CampaignDetail
        campaignId={selectedId}
        onBack={() => set({ campaign: null })}
        onDeleted={() => {
          // Optimista: la lista ya no muestra la borrada mientras refetchea.
          setCampaigns((prev) => prev?.filter((c) => c.id !== selectedId) ?? prev);
          set({ campaign: null });
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <h2 className="font-semibold">Campañas</h2>
        <Button size="sm" onClick={() => setCreating(true)} data-testid="new-campaign">
          <Plus className="mr-1.5 h-4 w-4" />
          Nueva campaña
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <HowItWorks settings={settings} />

        <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="campaign-filters">
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value || "all"}
                type="button"
                onClick={() => set({ status: f.value || null })}
                data-testid={`status-filter-${f.value || "all"}`}
                aria-pressed={statusFilter === f.value}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  statusFilter === f.value
                    ? "border-brand bg-brand text-white"
                    : "bg-card text-muted-foreground hover:border-brand/50"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre…"
              className="h-8 pl-8 text-xs"
              data-testid="campaign-search"
              aria-label="Buscar campañas por nombre"
            />
          </div>
        </div>

        {error && (
          <p
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            data-testid="campaigns-error"
          >
            {error}
          </p>
        )}

        {campaigns === null ? (
          <p className="text-sm text-muted-foreground">Cargando campañas…</p>
        ) : campaigns.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
            <Megaphone className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {statusFilter || q ? "Ninguna campaña coincide" : "Sin campañas"}
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              {statusFilter || q
                ? "Probá con otro estado o borrá la búsqueda."
                : "Una campaña envía una plantilla aprobada a un segmento de tus contactos con consentimiento, de a poco y respetando el cupo del canal. Importá tu lista en Contactos y creá la primera."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2" data-testid="campaign-list">
            {campaigns.map((c) => (
              <li
                key={c.id}
                data-testid="campaign-row"
                data-status={c.status}
                className="rounded-lg border bg-card px-4 py-3 hover:border-brand/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => set({ campaign: c.id })}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{c.name}</span>
                      <StatusBadge status={c.status} pausedReason={c.pausedReason} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {c.templateName}
                      {c.tagFilter.length > 0
                        ? ` · #${c.tagFilter.join(" #")}`
                        : " · todos los elegibles"}
                      {c.status === "draft" && ` · creada ${formatDate(c.createdAt)}`}
                      {c.launchedAt && ` · lanzada ${formatDate(c.launchedAt)}`}
                    </p>
                    <CountsLine campaign={c} settings={settings} className="mt-1.5" />
                  </button>
                  <RowActions
                    campaign={c}
                    onAction={(action) =>
                      setConfirm(buildConfirm(c, action, settings, () => act(c, action)))
                    }
                  />
                </div>
                {c.counts.total > 0 && <ProgressBar counts={c.counts} className="mt-2" />}
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
            set({ campaign: id });
          }}
        />
      )}
      {confirm && <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function RowActions({
  campaign: c,
  onAction,
}: {
  campaign: CampaignListItem;
  onAction: (action: Action) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1" data-testid="row-actions">
      {c.status === "draft" && (
        <Button
          size="sm"
          onClick={() => onAction("launch")}
          data-testid="row-launch"
          disabled={c.eligibleNow === 0}
          title={
            c.eligibleNow === 0
              ? "No hay contactos elegibles con estas etiquetas"
              : "Congela los destinatarios y empieza a enviar"
          }
        >
          <Play className="mr-1 h-3.5 w-3.5" />
          Lanzar
        </Button>
      )}
      {(c.status === "running" ||
        (c.status === "paused" && c.pausedReason !== "manual")) && (
        <Button variant="outline" size="sm" onClick={() => onAction("pause")} data-testid="row-pause">
          <Pause className="mr-1 h-3.5 w-3.5" />
          Pausar
        </Button>
      )}
      {c.status === "paused" && (
        <Button size="sm" onClick={() => onAction("resume")} data-testid="row-resume">
          <Play className="mr-1 h-3.5 w-3.5" />
          Reanudar
        </Button>
      )}
      {(c.status === "running" || c.status === "paused") && (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => onAction("cancel")}
          data-testid="row-cancel"
        >
          <XCircle className="mr-1 h-3.5 w-3.5" />
          Cancelar
        </Button>
      )}
      {canDelete(c.status) && (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => onAction("delete")}
          aria-label={`Borrar campaña ${c.name}`}
          data-testid="row-delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cómo funciona (ciclo de vida)                                       */
/* ------------------------------------------------------------------ */

const LIFECYCLE_STEPS: { key: string; title: string; text: string }[] = [
  {
    key: "draft",
    title: "1 · Borrador",
    text: "No envía nada. Elegís plantilla aprobada y etiquetas; el número de elegibles se recalcula hasta que lances.",
  },
  {
    key: "launch",
    title: "2 · Lanzar",
    text: "Se congela la lista: contactos con consentimiento, sin baja ni archivo, con alguna de las etiquetas. Empieza a enviar enseguida.",
  },
  {
    key: "running",
    title: "3 · En curso",
    text: "Envía de a UN mensaje por vez, en escalones según el ritmo de la instancia. Se pausa sola si se agota el cupo de 24h (y se reanuda sola) o si el canal falla.",
  },
  {
    key: "paused",
    title: "Pausar / Reanudar",
    text: "Podés pausar cuando quieras; lo enviado no se revierte. Reanudar sigue por donde iba, sin duplicar envíos.",
  },
  {
    key: "end",
    title: "4 · Completada o Cancelada",
    text: "Completada: todos procesados. Cancelar corta la campaña: los pendientes quedan omitidos y no se puede reanudar. Solo se borran borradores, completadas y canceladas.",
  },
];

function HowItWorks({ settings }: { settings: Settings | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(HELP_KEY) !== "hidden");
    } catch {
      setOpen(true);
    }
  }, []);
  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(HELP_KEY, next ? "open" : "hidden");
    } catch {
      // sin storage: solo estado en memoria
    }
  }
  return (
    <section className="mb-4 rounded-lg border bg-card" data-testid="lifecycle-panel">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <HelpCircle className="h-4 w-4 text-brand" />
          ¿Cómo funciona una campaña?
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t px-4 py-3">
          <ol className="grid gap-3 md:grid-cols-5">
            {LIFECYCLE_STEPS.map((s) => (
              <li key={s.key} className="text-xs">
                <p className="font-medium">{s.title}</p>
                <p className="mt-0.5 text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
          {settings && (
            <p className="mt-3 text-xs text-muted-foreground" data-testid="lifecycle-settings">
              Ritmo actual: 1 mensaje cada{" "}
              <span className="font-medium text-foreground">
                {formatDuration(settings.paceMs)}
              </span>
              {" · "}Cupo de 24h:{" "}
              <span className="font-medium text-foreground">
                {settings.available} disponibles
              </span>{" "}
              de {settings.dailyInitiatedLimit} ({settings.usedLast24h} usados). El cupo
              cuenta contactos únicos sin conversación abierta en las últimas 24h; se
              ajusta en Ajustes → Envíos y campañas.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Piezas compartidas                                                  */
/* ------------------------------------------------------------------ */

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
      : status === "completed"
        ? "success"
        : status === "cancelled"
          ? "destructive"
          : "secondary";
  const autoPause = status === "paused" && pausedReason && pausedReason !== "manual";
  return (
    <Badge
      variant={variant}
      className={cn(autoPause && "border-[#f0dfb8] bg-[#fbf5e6] text-[#8a6a1f]")}
      data-testid="status-badge"
    >
      {STATUS_LABELS[status] ?? status}
      {status === "paused" && pausedReason
        ? ` ${PAUSE_LABELS[pausedReason] ?? ""}`
        : ""}
    </Badge>
  );
}

function CountsLine({
  campaign: c,
  settings,
  className,
}: {
  campaign: { status: string; eligibleNow: number | null; counts: Counts };
  settings: Settings | null;
  className?: string;
}) {
  if (c.status === "draft") {
    return (
      <p
        className={cn(
          "text-xs",
          c.eligibleNow === 0 ? "text-destructive" : "text-muted-foreground",
          className
        )}
        data-testid="draft-eligible"
      >
        {c.eligibleNow === null
          ? "Calculando elegibles…"
          : `${c.eligibleNow} elegible(s) hoy · la lista se congela al lanzar`}
      </p>
    );
  }
  return <CountsBar counts={c.counts} settings={settings} status={c.status} className={className} />;
}

function CountsBar({
  counts,
  settings,
  status,
  className,
}: {
  counts: Counts;
  settings: Settings | null;
  status: string;
  className?: string;
}) {
  const parts: { label: string; value: number; tone?: string }[] = [
    { label: "pendientes", value: counts.pending },
    { label: "enviados", value: counts.sent },
    { label: "entregados", value: counts.delivered },
    { label: "leídos", value: counts.read },
    { label: "respondieron", value: counts.replied, tone: "text-brand" },
    { label: "fallidos", value: counts.failed, tone: "text-destructive" },
    { label: "omitidos", value: counts.skipped },
  ];
  const eta =
    status === "running" && settings && counts.pending > 0
      ? formatDuration(counts.pending * settings.paceMs)
      : null;
  return (
    <p className={cn("text-xs text-muted-foreground", className)} data-testid="counts-line">
      {counts.total} destinatarios
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span key={p.label} className={p.tone}>
            {" "}
            · {p.value} {p.label}
          </span>
        ))}
      {eta && <span> · ~{eta} restantes</span>}
    </p>
  );
}

function ProgressBar({ counts, className }: { counts: Counts; className?: string }) {
  const done = counts.total - counts.pending;
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-secondary", className)}>
      <div
        className="h-full bg-brand transition-all"
        style={{ width: `${Math.round((done / counts.total) * 100)}%` }}
      />
    </div>
  );
}

type ConfirmState = {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
};

function buildConfirm(
  c: { name: string; status: string; eligibleNow: number | null; counts: Counts },
  action: Action,
  settings: Settings | null,
  run: () => Promise<void> | void
): ConfirmState {
  const pace = settings ? formatDuration(settings.paceMs) : "unos segundos";
  switch (action) {
    case "launch":
      return {
        title: `Lanzar «${c.name}»`,
        body: `Se congela la lista de ${c.eligibleNow ?? "los"} destinatario(s) elegibles hoy y se empieza a enviar enseguida, de a un mensaje cada ${pace}. ${
          settings ? `Cupo de 24h disponible: ${settings.available} de ${settings.dailyInitiatedLimit}; si se agota, la campaña se pausa sola y se reanuda sola.` : ""
        } Podés pausar o cancelar en cualquier momento; lo ya enviado no se revierte.`,
        confirmLabel: "Lanzar ahora",
        onConfirm: run,
      };
    case "pause":
      return {
        title: `Pausar «${c.name}»`,
        body: "Deja de enviar hasta que la reanudes. Los mensajes ya enviados siguen su curso (entregas, lecturas y respuestas se siguen registrando).",
        confirmLabel: "Pausar",
        onConfirm: run,
      };
    case "resume":
      return {
        title: `Reanudar «${c.name}»`,
        body: `Sigue por donde iba con los ${c.counts.pending} pendiente(s), sin repetir envíos.`,
        confirmLabel: "Reanudar",
        onConfirm: run,
      };
    case "cancel":
      return {
        title: `Cancelar «${c.name}»`,
        body: `Los ${c.counts.pending} pendiente(s) quedan omitidos de forma definitiva y la campaña no se puede reanudar. Lo ya enviado no se revierte.`,
        confirmLabel: "Cancelar campaña",
        destructive: true,
        onConfirm: run,
      };
    case "delete":
      return {
        title: `Borrar «${c.name}»`,
        body:
          c.status === "draft"
            ? "El borrador se elimina. No se envió nada."
            : "Se borra la campaña y su seguimiento por destinatario. Los mensajes ya enviados quedan en las conversaciones de cada contacto.",
        confirmLabel: "Borrar",
        destructive: true,
        onConfirm: run,
      };
  }
}

function ConfirmDialog({
  state,
  onClose,
}: {
  state: ConfirmState;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      data-testid="confirm-dialog"
    >
      <div
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold">{state.title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{state.body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy} data-testid="confirm-no">
            Volver
          </Button>
          <Button
            variant={state.destructive ? "destructive" : "default"}
            disabled={busy}
            data-testid="confirm-yes"
            onClick={async () => {
              setBusy(true);
              await state.onConfirm();
              setBusy(false);
              onClose();
            }}
          >
            {busy ? "Un momento…" : state.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Nueva campaña                                                       */
/* ------------------------------------------------------------------ */

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
  const [tags, setTags] = useState<string[]>([]);
  const [variableMode, setVariableMode] = useState<"contact_name" | "fixed">(
    "contact_name"
  );
  const [variableText, setVariableText] = useState("");
  const [eligible, setEligible] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { facets } = useTagFacets("contacts");

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: TemplateDto[] }) =>
        setTemplates((d.templates ?? []).filter((t) => t.status === "approved"))
      )
      .catch(() => setTemplates([]));
  }, []);

  // Vista previa del segmento elegible (FR-013).
  const tagsKey = tags.join(",");
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/segment-preview?tags=${encodeURIComponent(tagsKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { eligible: number } | null) => {
        if (!cancelled) setEligible(d?.eligible ?? null);
      })
      .catch(() => setEligible(null));
    return () => {
      cancelled = true;
    };
  }, [tagsKey]);

  const options = useMemo(
    () => facets.filter((f) => !tags.includes(f.tag)),
    [facets, tags]
  );
  const selected = templates?.find((t) => t.id === templateId) ?? null;
  const needsVariable = selected ? /\{\{\s*1\s*\}\}/.test(selected.body) : false;

  async function create() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        templateId,
        tagFilter: tags,
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
        data-testid="new-campaign-dialog"
      >
        <h3 className="font-semibold">Nueva campaña</h3>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">
          Se guarda como borrador: no envía nada hasta que la lances.
        </p>
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
            <TemplatePreview
              body={selected.body}
              headerImageUrl={selected.headerImageUrl}
              compact
            />
          )}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Segmento por etiquetas</span>
            <div className="flex flex-wrap items-center gap-1.5" data-testid="cmp-tags">
              {tags.map((t) => (
                <TagChip
                  key={t}
                  tag={t}
                  onRemove={() => setTags(tags.filter((x) => x !== t))}
                />
              ))}
              <TagPicker
                options={options}
                allowCreate={false}
                emptyText="No hay etiquetas en tus contactos"
                placeholder="Buscar etiqueta…"
                onPick={(tag) => setTags(sanitizeTags([...tags, tag]))}
                trigger={() => (
                  <span className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground hover:border-brand/60 hover:text-foreground">
                    <Tag className="h-3 w-3" />
                    {tags.length ? "Agregar" : "Elegir etiquetas"}
                  </span>
                )}
              />
            </div>
            <p
              className={cn(
                "text-xs",
                eligible === 0 ? "text-destructive" : "text-muted-foreground"
              )}
              data-testid="cmp-eligible"
            >
              {tags.length === 0 ? "Sin etiquetas = todos los elegibles. " : "Con AL MENOS una de esas etiquetas. "}
              {eligible !== null &&
                `${eligible} contacto(s) elegible(s) hoy (con consentimiento, sin baja).`}
            </p>
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
                    className="accent-brand"
                  />
                  el nombre del contacto
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={variableMode === "fixed"}
                    onChange={() => setVariableMode("fixed")}
                    className="accent-brand"
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
            data-testid="cmp-create"
          >
            {saving ? "Creando…" : "Crear borrador"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detalle                                                             */
/* ------------------------------------------------------------------ */

type CampaignDetailData = {
  settings: Settings;
  campaign: {
    id: string;
    name: string;
    status: string;
    pausedReason: string | null;
    templateName: string;
    tagFilter: string[];
    variableMode: string;
    variableText: string | null;
    createdAt: string;
    launchedAt: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
    eligibleNow: number | null;
  };
  counts: Counts;
  recipients: RecipientRow[];
  nextCursor: string | null;
};

function CampaignDetail({
  campaignId,
  onBack,
  onDeleted,
}: {
  campaignId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [data, setData] = useState<CampaignDetailData | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}`).catch(() => null);
    if (res?.status === 404) {
      setMissing(true);
      return;
    }
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

  async function act(action: Action) {
    setError(null);
    const result = await runAction(campaignId, action);
    if (!result.ok) {
      setError(result.message);
    } else if (action === "delete") {
      onDeleted();
      return;
    }
    void refetch();
  }

  if (missing) {
    return (
      <div className="p-6">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Volver a campañas
        </Button>
        <p className="mt-4 text-sm text-muted-foreground">
          Esta campaña ya no existe.
        </p>
      </div>
    );
  }
  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">Cargando campaña…</div>;
  }
  const { campaign, counts, settings } = data;
  const c = { ...campaign, counts };
  const ask = (action: Action) =>
    setConfirm(buildConfirm(c, action, settings, () => act(action)));

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Volver">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="truncate font-semibold">{campaign.name}</h2>
          <StatusBadge status={campaign.status} pausedReason={campaign.pausedReason} />
        </div>
        <div className="flex shrink-0 items-center gap-2" data-testid="detail-actions">
          {campaign.status === "draft" && (
            <Button
              size="sm"
              onClick={() => ask("launch")}
              disabled={campaign.eligibleNow === 0}
              data-testid="detail-launch"
            >
              <Play className="mr-1.5 h-4 w-4" />
              Lanzar
            </Button>
          )}
          {(campaign.status === "running" ||
            (campaign.status === "paused" && campaign.pausedReason !== "manual")) && (
            <Button variant="outline" size="sm" onClick={() => ask("pause")} data-testid="detail-pause">
              <Pause className="mr-1.5 h-4 w-4" />
              Pausar
            </Button>
          )}
          {campaign.status === "paused" && (
            <Button size="sm" onClick={() => ask("resume")} data-testid="detail-resume">
              <Play className="mr-1.5 h-4 w-4" />
              Reanudar
            </Button>
          )}
          {(campaign.status === "running" || campaign.status === "paused") && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => ask("cancel")}
              data-testid="detail-cancel"
            >
              <XCircle className="mr-1.5 h-4 w-4" />
              Cancelar
            </Button>
          )}
          {canDelete(campaign.status) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => ask("delete")}
              data-testid="detail-delete"
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Borrar
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <p
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            data-testid="detail-error"
          >
            {error}
          </p>
        )}

        <Lifecycle campaign={campaign} counts={counts} settings={settings} />

        <div className="mb-4 rounded-lg border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Plantilla <span className="font-medium text-foreground">{campaign.templateName}</span>
            {campaign.tagFilter.length > 0
              ? ` · segmento #${campaign.tagFilter.join(" #")}`
              : " · todos los elegibles"}
            {campaign.variableMode === "fixed" && campaign.variableText
              ? ` · {{1}} = «${campaign.variableText}»`
              : ""}
            {` · creada ${formatDate(campaign.createdAt)}`}
            {campaign.launchedAt && ` · lanzada ${formatDate(campaign.launchedAt)}`}
            {campaign.completedAt && ` · completada ${formatDate(campaign.completedAt)}`}
            {campaign.cancelledAt && ` · cancelada ${formatDate(campaign.cancelledAt)}`}
          </p>
          <CountsLine campaign={c} settings={settings} className="mt-1" />
          {counts.total > 0 && <ProgressBar counts={counts} className="mt-2" />}
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
                      <span className="text-muted-foreground">{formatPhone(r.phone)}</span>
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
      {confirm && <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

/** Ciclo de vida: dónde está la campaña, qué hace ahora y qué sigue. */
function Lifecycle({
  campaign,
  counts,
  settings,
}: {
  campaign: CampaignDetailData["campaign"];
  counts: Counts;
  settings: Settings;
}) {
  const steps = [
    { key: "draft", label: "Borrador" },
    { key: "running", label: "En curso" },
    {
      key: "end",
      label: campaign.status === "cancelled" ? "Cancelada" : "Completada",
    },
  ];
  const idx =
    campaign.status === "draft"
      ? 0
      : campaign.status === "running" || campaign.status === "paused"
        ? 1
        : 2;

  let now: string;
  let next: string;
  switch (campaign.status) {
    case "draft":
      now =
        campaign.eligibleNow === 0
          ? "No hay contactos elegibles con estas etiquetas: sumá consentimiento o etiquetas en Contactos."
          : `Hoy entrarían ${campaign.eligibleNow ?? "…"} destinatario(s). Nada se envió todavía.`;
      next = `Al lanzar, la lista se congela y se empieza a enviar de a un mensaje cada ${formatDuration(settings.paceMs)}.`;
      break;
    case "running":
      now = `Enviando en escalones: un mensaje cada ${formatDuration(settings.paceMs)}. Quedan ${counts.pending} pendiente(s)${
        counts.pending > 0 ? ` (~${formatDuration(counts.pending * settings.paceMs)})` : ""
      }.`;
      next = `Cupo de 24h: ${settings.available} disponibles de ${settings.dailyInitiatedLimit}. Si se agota, se pausa sola y se reanuda sola al liberarse. Podés pausar o cancelar cuando quieras.`;
      break;
    case "paused":
      now =
        campaign.pausedReason === "manual"
          ? `Pausada por vos. Quedan ${counts.pending} pendiente(s); no se envía nada hasta que la reanudes.`
          : campaign.pausedReason === "daily_limit"
            ? `Pausada por el cupo de 24h (${settings.usedLast24h}/${settings.dailyInitiatedLimit} usados). Se reanuda sola a medida que se libera cupo; también podés subir el límite en Ajustes → Envíos y campañas.`
            : campaign.pausedReason === "channel"
              ? "Pausada porque el canal falló (plantilla o conexión de WhatsApp). Revisá Ajustes y reanudala."
              : "Pausada por un error interno. Reanudala para reintentar los pendientes.";
      next = "Reanudar sigue por donde iba sin duplicar envíos. Cancelar omite los pendientes de forma definitiva.";
      break;
    case "completed":
      now = `Terminó: ${counts.sent} enviado(s), ${counts.failed} fallido(s), ${counts.skipped} omitido(s).`;
      next = "Las entregas, lecturas y respuestas se siguen actualizando. Podés borrarla cuando no la necesites; las conversaciones quedan.";
      break;
    default:
      now = `Cancelada: ${counts.sent} enviado(s) antes de cortar, ${counts.skipped} omitido(s).`;
      next = "No se puede reanudar. Para repetirla, creá una campaña nueva.";
  }

  return (
    <section className="mb-4 rounded-lg border bg-card px-4 py-3" data-testid="lifecycle">
      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                i < idx && "border-brand bg-brand text-white",
                i === idx &&
                  (campaign.status === "cancelled"
                    ? "border-destructive text-destructive"
                    : "border-brand text-brand"),
                i > idx && "text-muted-foreground"
              )}
            >
              {i < idx ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={cn(i === idx ? "font-medium" : "text-muted-foreground")}>
              {s.label}
              {i === idx && campaign.status === "paused" && " (pausada)"}
            </span>
            {i < steps.length - 1 && <span className="text-muted-foreground">→</span>}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-sm" data-testid="lifecycle-now">
        {now}
      </p>
      <p className="mt-1 text-xs text-muted-foreground" data-testid="lifecycle-next">
        {next}
      </p>
    </section>
  );
}

function RecipientStatus({ r }: { r: RecipientRow }) {
  if (r.repliedAt) return <span className="text-brand">respondió</span>;
  if (r.status === "sent") {
    if (r.deliveryStatus === "failed")
      return <span className="text-destructive">falló la entrega</span>;
    if (r.deliveryStatus === "read") return <span>leído ✓✓</span>;
    if (r.deliveryStatus === "delivered") return <span>entregado ✓✓</span>;
    return <span>enviado ✓</span>;
  }
  if (r.status === "failed") return <span className="text-destructive">fallido</span>;
  if (r.status === "skipped") return <span className="text-muted-foreground">omitido</span>;
  if (r.status === "sending") return <span>enviando…</span>;
  return <span className="text-muted-foreground">pendiente</span>;
}
