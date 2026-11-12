"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Braces, Pencil, RefreshCw, Trash2 } from "lucide-react";
import type { TemplateDto } from "@/lib/types";
import {
  countVariables,
  findOpenVariableAtCursor,
  MAX_TEMPLATE_VARIABLES,
  originByKey,
  sampleValuesFor,
  validateBodyVariables,
  VARIABLE_ORIGINS,
  type VariableOrigin,
} from "@/lib/template-body";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TemplatePreview } from "@/components/templates/template-preview";

const STATUS_BADGE: Record<
  TemplateDto["status"],
  { label: string; variant: "secondary" | "warning" | "success" | "destructive" }
> = {
  draft: { label: "Borrador", variant: "secondary" },
  pending: { label: "Pendiente de Meta", variant: "warning" },
  approved: { label: "Aprobada", variant: "success" },
  rejected: { label: "Rechazada", variant: "destructive" },
};

/** Límite de Meta para el componente BODY. */
const BODY_MAX = 1024;

export function TemplatesClient() {
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/templates").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { templates: TemplateDto[] };
    setTemplates(data.templates);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function sync() {
    setSyncing(true);
    setSyncMsg(null);
    const res = await fetch("/api/templates/sync", { method: "POST" }).catch(
      () => null
    );
    setSyncing(false);
    if (res?.ok) {
      const data = (await res.json()) as { updated: number };
      setSyncMsg(
        data.updated > 0
          ? `${data.updated} plantilla(s) actualizada(s)`
          : "Todo al día"
      );
      void refetch();
    } else {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setSyncMsg(data?.error?.message ?? "No se pudo sincronizar");
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Las plantillas permiten reabrir conversaciones con la ventana de 24 h
          cerrada. Meta las aprueba en horas o días; el estado se actualiza por
          webhook y con el botón Sincronizar (imprescindible en modo agencia,
          donde los eventos de plantillas no llegan al webhook de la instancia).
        </p>
        <Button
          variant="outline"
          size="sm"
          className="self-start md:self-auto"
          disabled={syncing}
          onClick={() => void sync()}
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          Sincronizar
        </Button>
      </div>
      {syncMsg && <p className="text-xs text-muted-foreground">{syncMsg}</p>}

      <TemplateEditor onSaved={() => void refetch()} />

      <div className="space-y-3">
        {templates.map((t) => (
          <TemplateRow
            key={t.id}
            template={t}
            onDeleted={(id) =>
              setTemplates((prev) => prev.filter((x) => x.id !== id))
            }
            onUpdated={(updated) =>
              setTemplates((prev) =>
                prev.map((x) => (x.id === updated.id ? updated : x))
              )
            }
          />
        ))}
        {templates.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Sin plantillas todavía. Crea la primera arriba — por ejemplo un
            «seguimos disponibles, ¿retomamos tu cotización?» para
            conversaciones frías.
          </p>
        )}
      </div>
    </div>
  );
}

const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "borrador",
  running: "en curso",
  paused: "pausada",
};

/** Campañas que bloquean el borrado o la edición, con enlace a cada una. */
function CampaignLinks({
  campaigns,
}: {
  campaigns: { id: string; name: string; status: string }[];
}) {
  return (
    <ul className="flex flex-wrap gap-1.5 text-xs" data-testid="blocked-by">
      {campaigns.map((c) => (
        <li key={c.id}>
          <a
            href={`/campaigns?campaign=${encodeURIComponent(c.id)}`}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-foreground hover:border-brand/60"
          >
            {c.name}
            <span className="text-muted-foreground">
              · {CAMPAIGN_STATUS_LABELS[c.status] ?? c.status}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** «13 nov, 14:05 h.» en la hora del navegador (24 h: sin «a. m.»). */
function formatNextEdit(iso: string): string {
  const when = new Date(iso).toLocaleString("es-AR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${when} h.`;
}

function TemplateRow({
  template: t,
  onDeleted,
  onUpdated,
}: {
  template: TemplateDto;
  onDeleted: (id: string) => void;
  onUpdated: (updated: TemplateDto) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedBy, setBlockedBy] = useState<
    { id: string; name: string; status: string }[]
  >([]);

  async function remove() {
    if (
      !window.confirm(
        `¿Borrar la plantilla «${t.name}» (${t.language})? Se elimina también en Meta y, si estaba aprobada, habrá que crearla y aprobarla de nuevo para volver a usarla.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    setBlockedBy([]);
    const res = await fetch(`/api/templates/${t.id}`, { method: "DELETE" }).catch(
      () => null
    );
    setDeleting(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: {
          message?: string;
          campaigns?: { id: string; name: string; status: string }[];
        };
      } | null;
      setError(data?.error?.message ?? "No se pudo borrar la plantilla");
      setBlockedBy(data?.error?.campaigns ?? []);
      return;
    }
    onDeleted(t.id);
  }

  if (editing) {
    return (
      <TemplateEditor
        template={t}
        onCancel={() => setEditing(false)}
        onSaved={(updated) => {
          setEditing(false);
          if (updated) onUpdated(updated);
        }}
      />
    );
  }

  const editBlocked = !t.edit.canEdit
    ? `${t.edit.message ?? "No se puede editar ahora."}${
        t.edit.nextEditAt
          ? ` Podés editarla de nuevo desde el ${formatNextEdit(t.edit.nextEditAt)}`
          : ""
      }`
    : null;

  return (
    <div
      data-testid="template-row"
      className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-[1fr_minmax(240px,300px)]"
    >
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-sm font-medium">
            {t.name}{" "}
            <span className="text-muted-foreground">({t.language})</span>
          </p>
          <Badge variant="secondary">{t.category}</Badge>
          <Badge variant={STATUS_BADGE[t.status].variant}>
            {STATUS_BADGE[t.status].label}
          </Badge>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {t.body}
        </p>
        {t.status === "rejected" && t.rejectionReason && (
          <p className="text-xs text-destructive">
            Razón del rechazo: {t.rejectionReason}
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {blockedBy.length > 0 && <CampaignLinks campaigns={blockedBy} />}
        {editBlocked && (
          <p className="text-xs text-text-3" data-testid="edit-blocked">
            {editBlocked}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={!t.edit.canEdit || deleting}
            title={editBlocked ?? undefined}
            onClick={() => setEditing(true)}
            aria-label={`Editar plantilla ${t.name}`}
          >
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={deleting}
            onClick={() => void remove()}
            aria-label={`Borrar plantilla ${t.name}`}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? "Borrando…" : "Borrar"}
          </Button>
        </div>
      </div>
      <TemplatePreview
        body={t.body}
        headerImageUrl={t.headerImageUrl}
        variableValues={
          t.variableBindings ? sampleValuesFor(t.variableBindings) : undefined
        }
        compact
      />
    </div>
  );
}

/** Tope y tipos de la imagen de encabezado (aviso temprano en cliente; el
 * server re-valida por magic bytes). */
const HEADER_IMAGE_MAX = 5 * 1024 * 1024;
const HEADER_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png"];

type BlockingCampaign = { id: string; name: string; status: string };

/**
 * Editor de plantilla (alta y, desde 052, edición). En edición el nombre y
 * el idioma son de solo lectura (Meta no los cambia), la categoría se
 * bloquea si está aprobada y el encabezado se conserva, reemplaza o quita.
 */
function TemplateEditor({
  template,
  onSaved,
  onCancel,
}: {
  /** Presente = edición de esa plantilla. */
  template?: TemplateDto;
  onSaved: (updated?: TemplateDto) => void;
  onCancel?: () => void;
}) {
  const editing = !!template;
  const [name, setName] = useState(template?.name ?? "");
  const [language, setLanguage] = useState(template?.language ?? "es_MX");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">(
    template?.category === "MARKETING" ? "MARKETING" : "UTILITY"
  );
  const [body, setBody] = useState(template?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedBy, setBlockedBy] = useState<BlockingCampaign[]>([]);
  const [headerImage, setHeaderImage] = useState<File | null>(null);
  const [removeExisting, setRemoveExisting] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [bindings, setBindings] = useState<string[]>(
    template?.variableBindings ?? []
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const existingImage = template?.headerImageUrl ?? null;
  const categoryLocked = template?.edit.categoryLocked ?? false;

  // El objectURL del preview se libera al reemplazarlo o desmontar.
  useEffect(() => {
    if (!headerImage) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(headerImage);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [headerImage]);

  const variableError = useMemo(() => validateBodyVariables(body), [body]);
  const varCount = variableError ? 0 : countVariables(body);

  // Los bindings siguen al cuerpo: uno por variable, en orden. Al agregar la
  // primera se propone "nombre del contacto"; las siguientes, texto libre.
  useEffect(() => {
    setBindings((prev) => {
      if (prev.length === varCount) return prev;
      const next = prev.slice(0, varCount);
      while (next.length < varCount) {
        next.push(next.length === 0 ? "contact_name" : "free_text");
      }
      return next;
    });
  }, [varCount]);

  const previewValues = useMemo(
    () => (varCount > 0 ? sampleValuesFor(bindings) : undefined),
    [bindings, varCount]
  );

  const headerMode: "keep" | "remove" | "replace" = headerImage
    ? "replace"
    : existingImage && removeExisting
      ? "remove"
      : "keep";
  const previewImage =
    imagePreview ?? (existingImage && !removeExisting ? existingImage : null);

  function pickImage(file: File | null) {
    setImageError(null);
    if (!file) {
      setHeaderImage(null);
      return;
    }
    if (!HEADER_IMAGE_TYPES.includes(file.type)) {
      setHeaderImage(null);
      setImageError("Solo se admiten imágenes JPEG o PNG");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    if (file.size > HEADER_IMAGE_MAX) {
      setHeaderImage(null);
      setImageError("La imagen supera el máximo de 5MB que acepta WhatsApp");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setHeaderImage(file);
  }

  async function save() {
    if (
      template?.status === "approved" &&
      !window.confirm(
        `«${template.name}» vuelve a revisión de Meta y, hasta que la apruebe, no se puede usar para campañas ni envíos. Meta permite editar una plantilla aprobada una vez por día (10 cada 30 días). ¿Guardar los cambios?`
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    setBlockedBy([]);
    const form = new FormData();
    form.set("category", category);
    form.set("body", body);
    if (varCount > 0) form.set("variables", JSON.stringify(bindings));
    if (editing) {
      form.set("headerMode", headerMode);
      if (headerImage) form.set("headerImage", headerImage);
    } else {
      form.set("name", name);
      form.set("language", language);
      if (headerImage) form.set("headerImage", headerImage);
    }
    const res = await fetch(
      editing ? `/api/templates/${template.id}` : "/api/templates",
      { method: editing ? "PATCH" : "POST", body: form }
    ).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string; campaigns?: BlockingCampaign[] };
      } | null;
      setError(
        data?.error?.message ??
          (editing ? "No se pudo editar la plantilla" : "No se pudo crear la plantilla")
      );
      setBlockedBy(data?.error?.campaigns ?? []);
      return;
    }
    if (editing) {
      const data = (await res.json()) as { template: TemplateDto };
      onSaved(data.template);
      return;
    }
    setName("");
    setBody("");
    setHeaderImage(null);
    if (fileInput.current) fileInput.current.value = "";
    onSaved();
  }

  return (
    <Card data-testid={editing ? "template-editor" : undefined}>
      <CardHeader>
        <CardTitle>
          {editing ? `Editar «${template.name}»` : "Nueva plantilla"}
        </CardTitle>
        <CardDescription>
          {editing ? (
            <>
              El nombre y el idioma no se cambian (para eso, creá otra). Al
              guardar vuelve a revisión de Meta
              {template.status === "approved"
                ? "; la categoría de una aprobada es fija y se puede editar una vez por día (10 cada 30 días)."
                : "."}
            </>
          ) : (
            <>
              Escribí <code>{"{{"}</code> para insertar una variable (hasta{" "}
              {MAX_TEMPLATE_VARIABLES}) y elegí su origen: nombre del contacto,
              su teléfono, tu empresa o texto libre. Se envía a aprobación de
              Meta al crearla.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor={editing ? `tpl-name-${template?.id}` : "tpl-name"}>Nombre</Label>
                <Input
                  id={editing ? `tpl-name-${template?.id}` : "tpl-name"}
                  placeholder="seguimiento_cotizacion"
                  value={name}
                  disabled={editing}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={editing ? `tpl-lang-${template?.id}` : "tpl-lang"}>Idioma</Label>
                <select
                  id={editing ? `tpl-lang-${template?.id}` : "tpl-lang"}
                  value={language}
                  disabled={editing}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60 md:h-9"
                >
                  {[language, "es_MX", "es", "es_AR", "en_US"]
                    .filter((l, i, all) => all.indexOf(l) === i)
                    .map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={editing ? `tpl-cat-${template?.id}` : "tpl-cat"}>Categoría</Label>
                <select
                  id={editing ? `tpl-cat-${template?.id}` : "tpl-cat"}
                  value={category}
                  disabled={categoryLocked}
                  title={
                    categoryLocked
                      ? "Meta no permite cambiar la categoría de una plantilla aprobada"
                      : undefined
                  }
                  onChange={(e) =>
                    setCategory(e.target.value as "UTILITY" | "MARKETING")
                  }
                  className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60 md:h-9"
                >
                  <option value="UTILITY">UTILITY (seguimiento)</option>
                  <option value="MARKETING">MARKETING</option>
                </select>
              </div>
            </div>

            <BodyEditor
              id={editing ? `tpl-body-${template?.id}` : "tpl-body"}
              value={body}
              onChange={setBody}
              error={variableError}
              nextIndex={varCount + 1}
              onPickOrigin={(key) => setBindings((prev) => [...prev, key])}
            />

            {varCount > 0 && (
              <div className="space-y-1.5" data-testid="variable-bindings">
                <Label>Origen de cada variable</Label>
                <div className="space-y-1.5">
                  {bindings.map((binding, i) => (
                    // 012: en móvil la descripción del origen baja a su propia línea.
                    <div key={i} className="flex flex-wrap items-center gap-2 md:flex-nowrap">
                      <code className="shrink-0 rounded bg-brand/15 px-1.5 py-0.5 font-mono text-xs text-brand-text">
                        {`{{${i + 1}}}`}
                      </code>
                      <select
                        aria-label={`Origen de la variable ${i + 1}`}
                        value={binding}
                        onChange={(e) =>
                          setBindings((prev) =>
                            prev.map((b, j) => (j === i ? e.target.value : b))
                          )
                        }
                        className="flex h-10 min-w-0 max-w-xs flex-1 rounded-md border border-input bg-card px-2 text-sm md:h-8 md:w-full md:flex-initial"
                      >
                        {VARIABLE_ORIGINS.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <span className="w-full text-xs text-text-3 md:w-auto md:truncate">
                        {originByKey(binding)?.description}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-text-3">
                  Los orígenes automáticos se completan solos al enviar; el
                  texto libre se pide al crear la campaña o al enviar 1:1.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={editing ? `tpl-image-${template?.id}` : "tpl-image"}>
                {editing && existingImage
                  ? "Imagen de encabezado"
                  : "Imagen de encabezado (opcional)"}
              </Label>
              {editing && existingImage && !headerImage && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-text-3">
                  <span data-testid="header-image-state">
                    {removeExisting
                      ? "Se va a quitar la imagen actual."
                      : "Se conserva la imagen actual (elegí otra para reemplazarla)."}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRemoveExisting((v) => !v)}
                  >
                    {removeExisting ? "Conservarla" : "Quitar imagen"}
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInput}
                  id={editing ? `tpl-image-${template?.id}` : "tpl-image"}
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
                  className="w-full max-w-full min-w-0 text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-accent"
                />
                {headerImage && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      pickImage(null);
                      if (fileInput.current) fileInput.current.value = "";
                    }}
                  >
                    Quitar
                  </Button>
                )}
              </div>
              {imageError ? (
                <p className="text-xs text-destructive">{imageError}</p>
              ) : (
                <p className="text-xs text-text-3">
                  JPEG o PNG de hasta 5MB. Va arriba del mensaje y Meta la
                  revisa junto con el texto (recomendado ~800×418px).
                </p>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {blockedBy.length > 0 && <CampaignLinks campaigns={blockedBy} />}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  saving || !name.trim() || !body.trim() || !!variableError
                }
                onClick={() => void save()}
              >
                {saving
                  ? "Enviando a Meta…"
                  : editing
                    ? "Guardar y enviar a revisión"
                    : "Crear y enviar a aprobación"}
              </Button>
              {onCancel && (
                <Button variant="outline" disabled={saving} onClick={onCancel}>
                  Cancelar
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-text-3">
              Vista previa
            </p>
            <TemplatePreview
              body={body}
              variableValues={previewValues}
              headerImageUrl={previewImage}
            />
            <p className="text-xs text-text-3">
              Formato admitido: *negrita*, _cursiva_, ~tachado~ y ```código```.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Textarea del cuerpo con autocompletado de variables: al escribir `{{`
 * aparece el CATÁLOGO DE ORÍGENES (009) — elegir uno inserta la próxima
 * variable {{n}} y deja su origen atado. El botón «Variable» inserta con el
 * origen por defecto (nombre del contacto para {{1}}, texto libre después).
 */
function BodyEditor({
  id,
  value,
  onChange,
  error,
  nextIndex,
  onPickOrigin,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  error: string | null;
  nextIndex: number;
  onPickOrigin: (originKey: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ start: number; end: number; query: string } | null>(
    null
  );
  const [active, setActive] = useState(0);
  const atMax = nextIndex > MAX_TEMPLATE_VARIABLES;

  const options: VariableOrigin[] = useMemo(() => {
    if (!menu) return [];
    const q = menu.query.toLowerCase();
    return VARIABLE_ORIGINS.filter(
      (o) => o.key.includes(q) || o.label.toLowerCase().includes(q)
    );
  }, [menu]);

  function refreshMenu(next: string, cursor: number) {
    const open = findOpenVariableAtCursor(next, cursor);
    setMenu(open);
    setActive(0);
  }

  function insertVariable(
    origin: VariableOrigin,
    range?: { start: number; end: number }
  ) {
    if (atMax) return;
    const el = ref.current;
    const token = `{{${nextIndex}}}`;
    const start = range?.start ?? el?.selectionStart ?? value.length;
    const end = range?.end ?? el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    onPickOrigin(origin.key);
    setMenu(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!menu) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setMenu(null);
      return;
    }
    if (options.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertVariable(options[active]!, menu);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>Cuerpo</Label>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[11px] tabular-nums text-text-4",
              value.length > BODY_MAX && "text-destructive"
            )}
          >
            {value.length}/{BODY_MAX}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={atMax}
            title={
              atMax
                ? `Máximo ${MAX_TEMPLATE_VARIABLES} variables por plantilla`
                : "Insertar variable en el cursor"
            }
            onClick={() =>
              insertVariable(
                nextIndex === 1 ? VARIABLE_ORIGINS[0] : VARIABLE_ORIGINS[3]
              )
            }
          >
            <Braces className="h-3.5 w-3.5" />
            Variable
          </Button>
        </div>
      </div>
      <div className="relative">
        <Textarea
          ref={ref}
          id={id}
          rows={4}
          placeholder="Hola {{1}}, seguimos disponibles. ¿Retomamos tu cotización?"
          value={value}
          aria-autocomplete="list"
          aria-expanded={!!menu}
          aria-controls={`${id}-variable-menu`}
          onChange={(e) => {
            onChange(e.target.value);
            refreshMenu(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={onKeyDown}
          onClick={(e) =>
            refreshMenu(value, e.currentTarget.selectionStart ?? value.length)
          }
          onBlur={() => setTimeout(() => setMenu(null), 120)}
        />
        {menu && (
          <div
            id={`${id}-variable-menu`}
            role="listbox"
            data-testid="template-variable-menu"
            className="absolute left-2 top-full z-20 mt-1 w-[min(100%,360px)] overflow-hidden rounded-md border border-border-strong bg-popover shadow-md"
          >
            <p className="border-b bg-subtle px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-3">
              {atMax
                ? `Máximo ${MAX_TEMPLATE_VARIABLES} variables`
                : `Insertar {{${nextIndex}}} con origen…`}
            </p>
            {options.length === 0 && (
              <p className="px-3 py-2 text-xs text-text-3">
                Ningún origen coincide con «{menu.query}».
              </p>
            )}
            {options.map((o, i) => (
              <button
                key={o.key}
                type="button"
                role="option"
                aria-selected={i === active}
                disabled={atMax}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => insertVariable(o, menu)}
                className={cn(
                  "flex w-full items-start gap-3 px-3 py-2 text-left text-sm",
                  i === active && !atMax && "bg-accent",
                  atMax && "cursor-not-allowed opacity-60"
                )}
              >
                <code className="mt-px shrink-0 rounded bg-brand/15 px-1.5 py-0.5 font-mono text-xs text-brand-text">
                  {`{{${nextIndex}}}`}
                </code>
                <span className="min-w-0">
                  <span className="block font-medium">{o.label}</span>
                  <span className="block text-xs text-text-3">
                    {atMax
                      ? `Máximo ${MAX_TEMPLATE_VARIABLES} variables por plantilla.`
                      : o.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-text-3">
          Cada variable {"{{n}}"} se ata a un origen abajo; los automáticos se
          completan solos al enviar.
        </p>
      )}
    </div>
  );
}
