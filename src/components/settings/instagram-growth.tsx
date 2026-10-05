"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  Download,
  EyeOff,
  Eye,
  Link2,
  Loader2,
  MessageCircleReply,
  Pencil,
  Plus,
  Radio,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { IgMediaPreview, IgMenuItem } from "@/lib/instagram/types";

/**
 * «Instagram que vende» (030): las secciones de Ajustes → Instagram que
 * reemplazan a ManyChat — respuestas a comentarios (con moderación y
 * actividad), primer contacto (preguntas frecuentes y menú) y links con
 * origen con su QR. Todo lo configura el propietario.
 */

export type GrowthIntegration = {
  username: string | null;
  status: "connected" | "reconnect_required";
  commentsEnabled: boolean;
  commentsDelivery: "webhook" | "poll";
  commentsPolledAt: string | null;
  commentsError: string | null;
  moderationWords: string[];
  iceBreakers: string[];
  persistentMenu: IgMenuItem[];
  profileSyncedAt: string | null;
  profileError: string | null;
  standbySeenAt: string | null;
};

type Rule = {
  id: string;
  name: string;
  target: "media" | "all" | "live";
  media: IgMediaPreview[];
  keywords: string[];
  dmText: string;
  buttonLabel: string | null;
  followUpText: string | null;
  publicReplies: string[];
  active: boolean;
  createdAt: string;
  stats: { replied: number; followUps: number };
};

type Activity = {
  commentId: string;
  username: string | null;
  text: string | null;
  status: "processing" | "replied" | "hidden" | "ignored" | "skipped" | "failed";
  detail: string | null;
  hidden: boolean;
  live: boolean;
  source: "webhook" | "poll";
  ruleName: string | null;
  conversationId: string | null;
  publicReply: boolean;
  at: string;
};

type EntryLink = {
  id: string;
  slug: string;
  label: string;
  instruction: string | null;
  url: string | null;
  tag: string;
  uses: number;
  lastUsedAt: string | null;
  createdAt: string;
};

type Media = {
  id: string;
  caption: string | null;
  mediaType: string | null;
  mediaProductType?: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
};

export type GrowthData = {
  integration: GrowthIntegration | null;
  rules: Rule[];
  activity: Activity[];
  links: EntryLink[];
};

const byteLength = (s: string) => new TextEncoder().encode(s).length;

function relTime(iso: string | null): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

async function readError(res: Response | null, fallback: string): Promise<string> {
  const body = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

function Notice({ kind, children }: { kind: "ok" | "error" | "warn"; children: React.ReactNode }) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        kind === "ok" && "border-[#d8e8dd] bg-[#eff7f1] text-[#3f6b52]",
        kind === "error" && "border-[#ecd4d2] bg-[#faf1f0] text-[#a2504c]",
        kind === "warn" && "border-[#ece2cf] bg-[#faf7f0] text-[#8a6d3b]"
      )}
    >
      {children}
    </p>
  );
}

/** Aviso de Conversation Routing: otra app (ManyChat) maneja hilos. */
export function StandbyWarning({ seenAt }: { seenAt: string | null }) {
  if (!seenAt || Date.now() - new Date(seenAt).getTime() > 7 * 24 * 60 * 60 * 1000) return null;
  return (
    <div data-testid="ig-standby-warning">
      <Notice kind="warn">
        <strong>Otra app maneja conversaciones de esta cuenta</strong> (por ejemplo ManyChat).
        Instagram le da cada conversación a UNA sola app: en esas, los mensajes llegan a la
        Bandeja pero el agente no puede responder. Para que responda el CRM, en Meta Business
        Suite → Configuración → Integraciones → Conversation Routing, elegí esta app como
        principal (o desconectá la otra herramienta). Último aviso: {relTime(seenAt)}.
      </Notice>
    </div>
  );
}

/* ============================================================
 * Comentarios
 * ============================================================ */

export function CommentsSection({
  data,
  canManage,
  onChange,
}: {
  data: GrowthData;
  canManage: boolean;
  onChange: () => Promise<void>;
}) {
  const integration = data.integration;
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!integration) return null;
  if (!integration.commentsEnabled) {
    return (
      <Card data-testid="ig-comments-reconnect">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircleReply className="h-4 w-4 text-[#d62976]" strokeWidth={1.8} />
            Respuestas a comentarios
          </CardTitle>
          <CardDescription>
            Para responder comentarios (el «comentá INFO y te mando el link por privado»), la
            cuenta tiene que dar el permiso de comentarios. Esta conexión es anterior: reconectala
            y aceptá todos los permisos en la ventana de Instagram.
          </CardDescription>
        </CardHeader>
        {canManage && (
          <CardContent className="px-5 pb-5">
            <a href="/api/integrations/instagram/connect" data-testid="ig-comments-reconnect-button">
              <Button>
                <Link2 className="h-4 w-4" strokeWidth={1.7} />
                Reconectar con Instagram
              </Button>
            </a>
          </CardContent>
        )}
      </Card>
    );
  }

  async function toggle(rule: Rule) {
    setError(null);
    const res = await fetch(`/api/integrations/instagram/comment-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !rule.active }),
    }).catch(() => null);
    if (!res?.ok) setError(await readError(res, "No se pudo cambiar la regla."));
    await onChange();
  }

  async function remove(rule: Rule) {
    if (!window.confirm(`¿Borrar la regla «${rule.name}»? Lo ya enviado queda en la Bandeja.`)) return;
    await fetch(`/api/integrations/instagram/comment-rules/${rule.id}`, { method: "DELETE" }).catch(() => null);
    await onChange();
  }

  return (
    <div className="space-y-6">
      <Card data-testid="ig-comment-rules">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <MessageCircleReply className="h-4 w-4 text-[#d62976]" strokeWidth={1.8} />
              Respuestas a comentarios
            </CardTitle>
            {canManage && (
              <Button size="sm" onClick={() => setEditing("new")} data-testid="ig-rule-new">
                <Plus className="h-4 w-4" strokeWidth={1.8} />
                Nueva regla
              </Button>
            )}
          </div>
          <CardDescription>
            Cuando alguien comenta una palabra clave en tu publicación, le llega un mensaje privado
            (una vez por comentario, como pide Instagram). Si responde, sale el seguimiento y
            después atiende el agente, sabiendo qué comentó.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-5 pb-5">
          <p className="text-xs text-muted-foreground" data-testid="ig-comments-delivery">
            {integration.commentsDelivery === "webhook"
              ? "Los comentarios llegan al instante."
              : `El CRM revisa los comentarios de las publicaciones con reglas cada minuto (Meta todavía no habilitó el aviso instantáneo para esta app). ${
                  integration.commentsPolledAt
                    ? `Última revisión: ${relTime(integration.commentsPolledAt)}.`
                    : "Empieza a revisar cuando haya una regla activa."
                }`}
          </p>
          {integration.commentsError && <Notice kind="warn">{integration.commentsError}</Notice>}
          {error && <Notice kind="error">{error}</Notice>}
          {data.rules.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Todavía no hay reglas. Creá una para responder automáticamente los comentarios.
            </p>
          ) : (
            <ul className="space-y-3">
              {data.rules.map((rule) => (
                <li key={rule.id} className="rounded-lg border p-3" data-testid="ig-rule">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {rule.name}
                        {rule.active ? (
                          <Badge variant="success">Activa</Badge>
                        ) : (
                          <Badge variant="secondary">Pausada</Badge>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {rule.target === "all"
                          ? "Todas las publicaciones"
                          : rule.target === "live"
                            ? "Comentarios en vivos"
                            : `${rule.media.length} publicación${rule.media.length === 1 ? "" : "es"}`}
                        {" · "}
                        {rule.keywords.length > 0 ? `palabras: ${rule.keywords.join(", ")}` : "cualquier comentario"}
                        {" · "}
                        {rule.stats.replied} DM enviado{rule.stats.replied === 1 ? "" : "s"}
                        {rule.followUpText ? ` · ${rule.stats.followUps} seguimiento${rule.stats.followUps === 1 ? "" : "s"}` : ""}
                      </p>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" variant="outline" onClick={() => void toggle(rule)} data-testid="ig-rule-toggle">
                          {rule.active ? "Pausar" : "Activar"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(rule)} aria-label="Editar">
                          <Pencil className="h-4 w-4" strokeWidth={1.7} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void remove(rule)} aria-label="Borrar">
                          <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                        </Button>
                      </div>
                    )}
                  </div>
                  {rule.target === "media" && rule.media.length > 0 && (
                    <div className="mt-2 flex gap-1.5 overflow-x-auto">
                      {rule.media.map((m) => (
                        <MediaThumb key={m.id} media={m} size="sm" />
                      ))}
                    </div>
                  )}
                  <p className="mt-2 whitespace-pre-wrap rounded-md bg-secondary/60 px-3 py-2 text-sm text-text-2">
                    {rule.dmText}
                    {rule.buttonLabel && (
                      <span className="mt-1.5 block">
                        <span className="inline-block rounded-full border bg-background px-2.5 py-0.5 text-xs">
                          {rule.buttonLabel}
                        </span>
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ModerationCard integration={integration} canManage={canManage} onChange={onChange} />
      <ActivityCard activity={data.activity} canManage={canManage} onChange={onChange} />

      {editing && (
        <RuleEditor
          rule={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChange();
          }}
        />
      )}
    </div>
  );
}

function MediaThumb({ media, size = "md" }: { media: IgMediaPreview | Media; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-12 w-12" : "h-20 w-20";
  return media.thumbnailUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- CDN de Meta, sin optimizador
    <img src={media.thumbnailUrl} alt={media.caption ?? ""} className={cn(dim, "shrink-0 rounded-md border object-cover")} />
  ) : (
    <span className={cn(dim, "flex shrink-0 items-center justify-center rounded-md border bg-secondary text-[10px] text-muted-foreground")}>
      {media.mediaType === "VIDEO" ? "Video" : "Post"}
    </span>
  );
}

/** «12 sep» (con el año si no es el actual). Tolera el `+0000` de Meta. */
function shortDate(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

function mediaKind(m: { mediaType: string | null; mediaProductType?: string | null }): string | null {
  if (m.mediaProductType === "REELS") return "Reel";
  if (m.mediaType === "VIDEO") return "Video";
  if (m.mediaType === "CAROUSEL_ALBUM") return "Carrusel";
  return null;
}

const normalizeText = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * 030: selector de publicaciones para una regla. Pensado para cuentas con
 * mucho contenido: la IMAGEN manda (cuadrada, ocupa la tarjeta), el texto va
 * en 2 líneas con el completo al pasar el mouse, fecha y tipo (Reel, Video,
 * Carrusel) para distinguir posts parecidos, búsqueda por texto, «Ver más»
 * de a 24 y una fila con las ya elegidas (siguen a la vista aunque se busque
 * o se cargue más).
 */
function MediaPicker({
  selected,
  onToggle,
}: {
  selected: IgMediaPreview[];
  onToggle: (m: Media | IgMediaPreview) => void;
}) {
  const [items, setItems] = useState<Media[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async (after: string | null) => {
    const res = await fetch(
      `/api/integrations/instagram/media${after ? `?after=${encodeURIComponent(after)}` : ""}`
    ).catch(() => null);
    if (!res?.ok) {
      setError(await readError(res, "No se pudieron traer las publicaciones."));
      setItems((cur) => cur ?? []);
      return;
    }
    const body = (await res.json()) as { media: Media[]; next: string | null };
    setItems((cur) => {
      const seen = new Set((cur ?? []).map((m) => m.id));
      return [...(cur ?? []), ...body.media.filter((m) => !seen.has(m.id))];
    });
    setNext(body.next);
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const needle = normalizeText(q.trim());
  const shown = (items ?? []).filter((m) => !needle || normalizeText(m.caption ?? "").includes(needle));

  return (
    <div className="space-y-2" data-testid="ig-media-picker">
      {selected.length > 0 && (
        <div className="rounded-md border bg-secondary/40 p-2" data-testid="ig-media-selected">
          <p className="mb-1.5 text-xs font-medium text-text-2">
            {selected.length === 1 ? "1 publicación elegida" : `${selected.length} publicaciones elegidas`}
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {selected.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onToggle(m)}
                title={`Quitar: ${m.caption ?? "publicación sin texto"}`}
                aria-label="Quitar publicación"
                className="group relative shrink-0"
              >
                <MediaThumb media={m} size="sm" />
                <span className="absolute -right-1 -top-1 rounded-full border bg-background p-0.5 text-text-2 shadow-sm group-hover:text-foreground">
                  <X className="h-3 w-3" strokeWidth={2} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" strokeWidth={1.7} />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por el texto de la publicación"
          className="pl-9"
          aria-label="Buscar publicaciones"
          data-testid="ig-media-search"
        />
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {!items ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-lg bg-secondary" />
          ))}
        </div>
      ) : items.length === 0 && !error ? (
        <p className="text-sm text-muted-foreground">La cuenta no tiene publicaciones.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="ig-media-empty">
          Ninguna de las {items.length} publicaciones cargadas dice «{q.trim()}».
          {next ? " Probá «Ver más publicaciones» para buscar en las anteriores." : ""}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="ig-media-grid">
          {shown.map((m) => {
            const on = selected.some((x) => x.id === m.id);
            const kind = mediaKind(m);
            const date = shortDate(m.timestamp);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onToggle(m)}
                data-testid="ig-media-option"
                aria-pressed={on}
                title={m.caption ?? "Publicación sin texto"}
                className={cn(
                  "group flex min-w-0 flex-col overflow-hidden rounded-lg border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  on ? "border-brand ring-2 ring-brand" : "hover:border-text-3"
                )}
              >
                <span className="relative block aspect-square w-full bg-secondary">
                  {m.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- CDN de Meta, sin optimizador
                    <img src={m.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[11px] text-text-3">
                      {kind ?? "Publicación"}
                    </span>
                  )}
                  {kind && m.thumbnailUrl && (
                    <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {kind}
                    </span>
                  )}
                  <span
                    className={cn(
                      "absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 shadow-sm",
                      on ? "border-brand bg-brand text-white" : "border-white bg-black/20 text-transparent group-hover:bg-black/30"
                    )}
                  >
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  {on && <span className="pointer-events-none absolute inset-0 bg-brand/10" />}
                </span>
                <span className="block min-w-0 px-1.5 pb-1.5 pt-1">
                  <span className="line-clamp-2 text-[11px] leading-snug text-text-2">{m.caption ?? "Sin texto"}</span>
                  {date && <span className="mt-0.5 block text-[10px] text-text-3">{date}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {items && next && (
        <div className="flex justify-center pt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={loadingMore}
            data-testid="ig-media-more"
            onClick={async () => {
              setLoadingMore(true);
              await load(next);
              setLoadingMore(false);
            }}
          >
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />}
            Ver más publicaciones
          </Button>
        </div>
      )}
    </div>
  );
}

function RuleEditor({
  rule,
  onClose,
  onSaved,
}: {
  rule: Rule | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(rule?.name ?? "");
  const [target, setTarget] = useState<Rule["target"]>(rule?.target ?? "media");
  const [selected, setSelected] = useState<IgMediaPreview[]>(rule?.media ?? []);
  const [keywords, setKeywords] = useState(rule?.keywords.join(", ") ?? "");
  const [dmText, setDmText] = useState(rule?.dmText ?? "");
  const [buttonLabel, setButtonLabel] = useState(rule?.buttonLabel ?? "");
  const [followUpText, setFollowUpText] = useState(rule?.followUpText ?? "");
  const [publicReplies, setPublicReplies] = useState(rule?.publicReplies.join("\n") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleMedia = (m: Media | IgMediaPreview) =>
    setSelected((cur) =>
      cur.some((x) => x.id === m.id)
        ? cur.filter((x) => x.id !== m.id)
        : [...cur, { id: m.id, caption: m.caption, thumbnailUrl: m.thumbnailUrl, permalink: m.permalink, mediaType: m.mediaType, timestamp: m.timestamp }]
    );

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      name,
      target,
      media: target === "media" ? selected : [],
      keywords,
      dmText,
      buttonLabel: buttonLabel.trim() || null,
      followUpText: followUpText.trim() || null,
      publicReplies: publicReplies.split("\n").map((s) => s.trim()).filter(Boolean),
      active: rule?.active ?? true,
    };
    const res = await fetch(
      rule ? `/api/integrations/instagram/comment-rules/${rule.id}` : "/api/integrations/instagram/comment-rules",
      { method: rule ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    ).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await readError(res, "No se pudo guardar la regla."));
      return;
    }
    await onSaved();
  }

  const dmBytes = byteLength(dmText);
  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title={rule ? "Editar regla" : "Nueva regla de comentarios"}
      testId="ig-rule-editor"
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} disabled={busy} data-testid="ig-rule-save">
            {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />}
            Guardar regla
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <Notice kind="error">{error}</Notice>}
        <div className="space-y-1.5">
          <Label htmlFor="ig-rule-name">Nombre (solo lo ves vos)</Label>
          <Input id="ig-rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Link de la cabaña Alba" />
        </div>

        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-medium">¿En qué publicaciones?</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["media", "Las que elija"],
                ["all", "Todas (también las nuevas)"],
                ["live", "Mis vivos"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTarget(value)}
                data-testid={`ig-rule-target-${value}`}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm",
                  target === value ? "border-brand bg-brand/10 text-foreground" : "text-text-2"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {target === "media" && <MediaPicker selected={selected} onToggle={toggleMedia} />}
          {target === "live" && (
            <p className="text-xs text-muted-foreground">
              Responde mientras dura el vivo. Instagram no permite respuestas públicas en vivos y
              avisa los comentarios solo cuando Meta aprueba el permiso de la app.
            </p>
          )}
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="ig-rule-keywords">Palabras clave (separadas por coma)</Label>
          <Input id="ig-rule-keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Ej.: INFO, precio, link" />
          <p className="text-xs text-muted-foreground">
            Sin mayúsculas ni tildes que importen. Vacío = responde cualquier comentario.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ig-rule-dm">Mensaje privado que le llega</Label>
          <Textarea id="ig-rule-dm" rows={4} value={dmText} onChange={(e) => setDmText(e.target.value)} placeholder="¡Hola {usuario}! Gracias por tu comentario 🙌 Tocá el botón y te paso el link." />
          <p className={cn("text-xs", dmBytes > 1000 ? "text-[#a2504c]" : "text-muted-foreground")}>
            {dmBytes}/1000 · {"{usuario}"} se reemplaza por su @usuario.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ig-rule-button">Botón del mensaje (opcional)</Label>
          <Input id="ig-rule-button" maxLength={20} value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} placeholder="Quiero el link" />
          <p className="text-xs text-muted-foreground">
            Instagram solo deja seguir la charla si la persona responde: un botón lo hace fácil.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ig-rule-followup">Seguimiento cuando responde (opcional)</Label>
          <Textarea id="ig-rule-followup" rows={3} value={followUpText} onChange={(e) => setFollowUpText(e.target.value)} placeholder="¡Acá está! https://… Si querés, te ayudo a elegir fechas." />
          <p className="text-xs text-muted-foreground">Sale una sola vez. Después atiende el agente.</p>
        </div>

        {target !== "live" && (
          <div className="space-y-1.5">
            <Label htmlFor="ig-rule-public">Respuestas públicas al comentario (opcional, una por línea)</Label>
            <Textarea id="ig-rule-public" rows={3} value={publicReplies} onChange={(e) => setPublicReplies(e.target.value)} placeholder={"¡Te escribimos por privado! 📩\n¡Listo, revisá tus mensajes!"} />
            <p className="text-xs text-muted-foreground">Se elige una al azar para que no parezca un robot.</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ModerationCard({
  integration,
  canManage,
  onChange,
}: {
  integration: GrowthIntegration;
  canManage: boolean;
  onChange: () => Promise<void>;
}) {
  const [words, setWords] = useState(integration.moderationWords.join(", "));
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setWords(integration.moderationWords.join(", ")), [integration.moderationWords]);

  async function save() {
    setBusy(true);
    setSaved(false);
    await fetch("/api/integrations/instagram/moderation", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words }),
    }).catch(() => null);
    setBusy(false);
    setSaved(true);
    await onChange();
  }

  return (
    <Card data-testid="ig-moderation">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldAlert className="h-4 w-4 text-text-2" strokeWidth={1.7} />
          Ocultar comentarios
        </CardTitle>
        <CardDescription>
          Los comentarios con estas palabras se ocultan solos: los sigue viendo quien los escribió,
          pero no el resto. No reciben mensaje privado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 px-5 pb-5">
        <Textarea rows={2} value={words} onChange={(e) => setWords(e.target.value)} disabled={!canManage} placeholder="Ej.: estafa, insultos, competidor.com" data-testid="ig-moderation-words" />
        {canManage && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void save()} disabled={busy} data-testid="ig-moderation-save">
              Guardar palabras
            </Button>
            {saved && <span className="text-xs text-muted-foreground">Guardado.</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_LABEL: Record<Activity["status"], { label: string; variant: "success" | "secondary" | "warning" | "destructive" }> = {
  processing: { label: "Procesando", variant: "secondary" },
  replied: { label: "Respondido", variant: "success" },
  hidden: { label: "Ocultado", variant: "warning" },
  ignored: { label: "Sin regla", variant: "secondary" },
  skipped: { label: "Omitido", variant: "secondary" },
  failed: { label: "Falló", variant: "destructive" },
};

function ActivityCard({
  activity,
  canManage,
  onChange,
}: {
  activity: Activity[];
  canManage: boolean;
  onChange: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  async function setHidden(a: Activity, hidden: boolean) {
    setError(null);
    const res = await fetch(`/api/integrations/instagram/comments/${encodeURIComponent(a.commentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden }),
    }).catch(() => null);
    if (!res?.ok) setError(await readError(res, "No se pudo cambiar el comentario."));
    await onChange();
  }
  return (
    <Card data-testid="ig-activity">
      <CardHeader>
        <CardTitle className="text-sm">Actividad reciente</CardTitle>
        <CardDescription>Los últimos comentarios que procesó el CRM y qué hizo con cada uno.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 px-5 pb-5">
        {error && <Notice kind="error">{error}</Notice>}
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay comentarios procesados.</p>
        ) : (
          <ul className="divide-y">
            {activity.map((a) => {
              const s = STATUS_LABEL[a.status];
              return (
                <li key={a.commentId} className="flex flex-wrap items-start justify-between gap-2 py-2" data-testid="ig-activity-item">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{a.username ? `@${a.username}` : "Alguien"}</span>
                      <Badge variant={a.hidden ? "warning" : s.variant}>
                        {a.hidden ? "Ocultado" : a.status === "hidden" ? "Visible de nuevo" : s.label}
                      </Badge>
                      {a.live && (
                        <span className="inline-flex items-center gap-1 text-xs text-[#d62976]">
                          <Radio className="h-3 w-3" strokeWidth={2} /> vivo
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{relTime(a.at)}</span>
                    </p>
                    {a.text && <p className="mt-0.5 break-words text-sm text-text-2">«{a.text}»</p>}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[a.ruleName ? `Regla: ${a.ruleName}` : null, a.publicReply ? "con respuesta pública" : null, a.detail]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {a.conversationId && (
                      <Link href={`/inbox?c=${a.conversationId}`} className="text-xs text-brand underline-offset-2 hover:underline">
                        Ver conversación
                      </Link>
                    )}
                    {canManage && a.status !== "ignored" && (
                      <Button size="sm" variant="ghost" onClick={() => void setHidden(a, !a.hidden)} aria-label={a.hidden ? "Mostrar" : "Ocultar"} data-testid="ig-activity-hide">
                        {a.hidden ? <Eye className="h-4 w-4" strokeWidth={1.7} /> : <EyeOff className="h-4 w-4" strokeWidth={1.7} />}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * Primer contacto
 * ============================================================ */

export function FirstContactSection({
  integration,
  canManage,
  onChange,
}: {
  integration: GrowthIntegration;
  canManage: boolean;
  onChange: () => Promise<void>;
}) {
  const [questions, setQuestions] = useState<string[]>(integration.iceBreakers);
  const [menu, setMenu] = useState<IgMenuItem[]>(integration.persistentMenu);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/integrations/instagram/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ iceBreakers: questions.filter((q) => q.trim()), menu }),
    }).catch(() => null);
    setBusy(false);
    const body = (await res?.json().catch(() => null)) as { synced?: boolean; error?: string | { message?: string } | null } | null;
    if (res?.ok && body?.synced) {
      setResult({ ok: true, text: "Guardado y aplicado en Instagram." });
    } else {
      const msg = typeof body?.error === "string" ? body.error : body?.error?.message;
      setResult({ ok: false, text: msg ?? "No se pudo guardar." });
    }
    await onChange();
  }

  return (
    <div className="space-y-6">
      <Card data-testid="ig-ice-breakers">
        <CardHeader>
          <CardTitle className="text-sm">Preguntas frecuentes al abrir el chat</CardTitle>
          <CardDescription>
            Hasta 4 preguntas que Instagram le sugiere a quien abre un chat nuevo con la cuenta. Al
            tocar una, el agente la responde. Se ven en la app del celular.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 px-5 pb-5">
          {questions.map((q, i) => (
            <div key={i} className="flex gap-2">
              <Input value={q} maxLength={80} disabled={!canManage} onChange={(e) => setQuestions((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} placeholder="¿Qué precio tiene?" data-testid="ig-ice-breaker" />
              {canManage && (
                <Button variant="ghost" size="sm" aria-label="Quitar" onClick={() => setQuestions((cur) => cur.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" strokeWidth={1.7} />
                </Button>
              )}
            </div>
          ))}
          {canManage && questions.length < 4 && (
            <Button variant="outline" size="sm" onClick={() => setQuestions((cur) => [...cur, ""])} data-testid="ig-ice-breaker-add">
              <Plus className="h-4 w-4" strokeWidth={1.8} />
              Agregar pregunta
            </Button>
          )}
        </CardContent>
      </Card>

      <Card data-testid="ig-menu">
        <CardHeader>
          <CardTitle className="text-sm">Menú fijo del chat</CardTitle>
          <CardDescription>
            Hasta 5 opciones que quedan siempre a mano en el chat: una pregunta (la responde el
            agente), un enlace a tu web, o «hablar con una persona» (pasa la conversación al equipo).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-5 pb-5">
          {menu.map((item, i) => (
            <div key={i} className="flex flex-wrap gap-2 rounded-md border p-2" data-testid="ig-menu-item">
              <select
                className="h-11 rounded-md border bg-transparent px-2 text-base md:h-9 md:text-sm"
                value={item.type}
                disabled={!canManage}
                onChange={(e) => {
                  const type = e.target.value as IgMenuItem["type"];
                  setMenu((cur) =>
                    cur.map((x, j) =>
                      j !== i ? x : type === "link" ? { type, title: x.title, url: "url" in x ? x.url : "https://" } : { type, title: x.title }
                    )
                  );
                }}
              >
                <option value="question">Pregunta</option>
                <option value="link">Enlace</option>
                <option value="human">Hablar con una persona</option>
              </select>
              <Input className="min-w-[10rem] flex-1" value={item.title} maxLength={30} disabled={!canManage} onChange={(e) => setMenu((cur) => cur.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Título" />
              {item.type === "link" && (
                <Input className="min-w-[12rem] flex-[2]" value={item.url} disabled={!canManage} onChange={(e) => setMenu((cur) => cur.map((x, j) => (j === i && x.type === "link" ? { ...x, url: e.target.value } : x)))} placeholder="https://tuweb.com" />
              )}
              {canManage && (
                <Button variant="ghost" size="sm" aria-label="Quitar" onClick={() => setMenu((cur) => cur.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" strokeWidth={1.7} />
                </Button>
              )}
            </div>
          ))}
          {canManage && menu.length < 5 && (
            <Button variant="outline" size="sm" onClick={() => setMenu((cur) => [...cur, { type: "question", title: "" }])} data-testid="ig-menu-add">
              <Plus className="h-4 w-4" strokeWidth={1.8} />
              Agregar opción
            </Button>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void save()} disabled={busy} data-testid="ig-profile-save">
            {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />}
            Guardar en Instagram
          </Button>
          {result ? (
            <span className={cn("text-sm", result.ok ? "text-[#3f6b52]" : "text-[#a2504c]")} data-testid="ig-profile-result">
              {result.text}
            </span>
          ) : integration.profileError ? (
            <span className="text-sm text-[#a2504c]">{integration.profileError}</span>
          ) : integration.profileSyncedAt ? (
            <span className="text-xs text-muted-foreground">Aplicado {relTime(integration.profileSyncedAt)}.</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * Links con origen
 * ============================================================ */

function slugPreview(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function LinksSection({
  data,
  canManage,
  onChange,
}: {
  data: GrowthData;
  canManage: boolean;
  onChange: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [qr, setQr] = useState<EntryLink | null>(null);
  const [editing, setEditing] = useState<EntryLink | null>(null);
  const autoSlug = useMemo(() => slugPreview(label), [label]);

  async function create() {
    setError(null);
    const res = await fetch("/api/integrations/instagram/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, slug: slug.trim() || undefined, instruction: instruction.trim() || null }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(await readError(res, "No se pudo crear el link."));
      return;
    }
    setLabel("");
    setSlug("");
    setInstruction("");
    await onChange();
  }

  async function copy(link: EntryLink) {
    if (!link.url) return;
    await navigator.clipboard?.writeText(link.url).catch(() => {});
    setCopied(link.id);
    setTimeout(() => setCopied(null), 1500);
  }

  async function remove(link: EntryLink) {
    if (!window.confirm(`¿Borrar «${link.label}»? Quien tenga el link igual podrá escribir, pero sin origen.`)) return;
    await fetch(`/api/integrations/instagram/links/${link.id}`, { method: "DELETE" }).catch(() => null);
    await onChange();
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <Card data-testid="ig-link-create">
          <CardHeader>
            <CardTitle className="text-sm">Nuevo link con origen</CardTitle>
            <CardDescription>
              Un link que abre el chat de Instagram de la cuenta y nos dice de dónde vino la persona
              (un flyer, la bio, una campaña). La conversación queda etiquetada y el agente arranca
              sabiendo el origen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-5 pb-5">
            {error && <Notice kind="error">{error}</Notice>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ig-link-label">Nombre</Label>
                <Input id="ig-link-label" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="Flyer cabañas" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ig-link-slug">Identificador (opcional)</Label>
                <Input id="ig-link-slug" value={slug} maxLength={40} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder={autoSlug || "flyer-cabanas"} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ig-link-instruction">Instrucción para el agente (opcional)</Label>
              <Textarea id="ig-link-instruction" rows={2} maxLength={500} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Ej.: Quienes llegan por este flyer tienen 10% de descuento en primavera." />
            </div>
            <Button onClick={() => void create()} disabled={!label.trim()} data-testid="ig-link-save">
              <Plus className="h-4 w-4" strokeWidth={1.8} />
              Crear link
            </Button>
          </CardContent>
        </Card>
      )}

      <Card data-testid="ig-links">
        <CardHeader>
          <CardTitle className="text-sm">Tus links</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {data.links.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no creaste links.</p>
          ) : (
            <ul className="divide-y">
              {data.links.map((link) => (
                <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="ig-link">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{link.label}</p>
                    <p className="break-all text-xs text-text-2" data-testid="ig-link-url">{link.url ?? "Conectá la cuenta para generar el link"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Etiqueta «{link.tag}» · {link.uses} conversación{link.uses === 1 ? "" : "es"}
                      {link.instruction ? " · con instrucción para el agente" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button size="sm" variant="outline" disabled={!link.url} onClick={() => void copy(link)}>
                      {copied === link.id ? <Check className="h-4 w-4" strokeWidth={1.8} /> : <Copy className="h-4 w-4" strokeWidth={1.7} />}
                      {copied === link.id ? "Copiado" : "Copiar"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={!link.url} onClick={() => setQr(link)} data-testid="ig-link-qr">
                      QR
                    </Button>
                    {canManage && (
                      <>
                        <Button size="sm" variant="ghost" aria-label="Editar" onClick={() => setEditing(link)}>
                          <Pencil className="h-4 w-4" strokeWidth={1.7} />
                        </Button>
                        <Button size="sm" variant="ghost" aria-label="Borrar" onClick={() => void remove(link)}>
                          <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {qr && (
        <Dialog open onClose={() => setQr(null)} title={`QR · ${qr.label}`} size="sm" testId="ig-qr-dialog">
          <div className="flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG propio del CRM */}
            <img src={`/api/integrations/instagram/links/${qr.id}/qr`} alt={`QR de ${qr.label}`} className="h-56 w-56 rounded-md border bg-white" data-testid="ig-qr-image" />
            <p className="break-all text-center text-xs text-muted-foreground">{qr.url}</p>
            <a href={`/api/integrations/instagram/links/${qr.id}/qr?download=1`} download>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" strokeWidth={1.7} />
                Descargar (SVG)
              </Button>
            </a>
          </div>
        </Dialog>
      )}

      {editing && (
        <LinkEditor
          link={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChange();
          }}
        />
      )}
    </div>
  );
}

function LinkEditor({ link, onClose, onSaved }: { link: EntryLink; onClose: () => void; onSaved: () => Promise<void> }) {
  const [label, setLabel] = useState(link.label);
  const [instruction, setInstruction] = useState(link.instruction ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = useCallback(async () => {
    const res = await fetch(`/api/integrations/instagram/links/${link.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, instruction: instruction.trim() || null }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(await readError(res, "No se pudo guardar."));
      return;
    }
    await onSaved();
  }, [label, instruction, link.id, onSaved]);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Editar link"
      description={`El identificador «${link.slug}» no cambia: el link ya pudo haberse compartido.`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void save()}>Guardar</Button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <Notice kind="error">{error}</Notice>}
        <div className="space-y-1.5">
          <Label htmlFor="ig-link-edit-label">Nombre</Label>
          <Input id="ig-link-edit-label" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ig-link-edit-instruction">Instrucción para el agente</Label>
          <Textarea id="ig-link-edit-instruction" rows={3} maxLength={500} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}
