"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Braces, RefreshCw, Trash2 } from "lucide-react";
import type { TemplateDto } from "@/lib/types";
import {
  countVariables,
  findOpenVariableAtCursor,
  TEMPLATE_VARIABLES,
  validateBodyVariables,
  type TemplateVariable,
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
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Las plantillas permiten reabrir conversaciones con la ventana de 24 h
          cerrada. Meta las aprueba en horas o días; el estado se actualiza por
          webhook y con el botón Sincronizar (imprescindible en modo agencia,
          donde los eventos de plantillas no llegan al webhook de la instancia).
        </p>
        <Button variant="outline" size="sm" disabled={syncing} onClick={() => void sync()}>
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          Sincronizar
        </Button>
      </div>
      {syncMsg && <p className="text-xs text-muted-foreground">{syncMsg}</p>}

      <CreateForm onCreated={() => void refetch()} />

      <div className="space-y-3">
        {templates.map((t) => (
          <TemplateRow
            key={t.id}
            template={t}
            onDeleted={(id) =>
              setTemplates((prev) => prev.filter((x) => x.id !== id))
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

function TemplateRow({
  template: t,
  onDeleted,
}: {
  template: TemplateDto;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const res = await fetch(`/api/templates/${t.id}`, { method: "DELETE" }).catch(
      () => null
    );
    setDeleting(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo borrar la plantilla");
      return;
    }
    onDeleted(t.id);
  }

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
        <div className="pt-1">
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
      <TemplatePreview body={t.body} compact />
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("es_MX");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [body, setBody] = useState("");
  const [sample, setSample] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variableError = useMemo(() => validateBodyVariables(body), [body]);
  const usesVariable = countVariables(body) === 1 && !variableError;

  async function create() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/templates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, language, category, body }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear la plantilla");
      return;
    }
    setName("");
    setBody("");
    onCreated();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva plantilla</CardTitle>
        <CardDescription>
          Escribí <code>{"{{"}</code> para insertar una variable. Por ahora se
          admite UNA sola, <code>{"{{1}}"}</code>. Se envía a aprobación de
          Meta al crearla.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Nombre</Label>
                <Input
                  id="tpl-name"
                  placeholder="seguimiento_cotizacion"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-lang">Idioma</Label>
                <select
                  id="tpl-lang"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                >
                  <option value="es_MX">es_MX</option>
                  <option value="es">es</option>
                  <option value="es_AR">es_AR</option>
                  <option value="en_US">en_US</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-cat">Categoría</Label>
                <select
                  id="tpl-cat"
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as "UTILITY" | "MARKETING")
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                >
                  <option value="UTILITY">UTILITY (seguimiento)</option>
                  <option value="MARKETING">MARKETING</option>
                </select>
              </div>
            </div>

            <BodyEditor value={body} onChange={setBody} error={variableError} />

            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              disabled={saving || !name.trim() || !body.trim() || !!variableError}
              onClick={() => void create()}
            >
              {saving ? "Enviando a Meta…" : "Crear y enviar a aprobación"}
            </Button>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-text-3">
              Vista previa
            </p>
            <TemplatePreview body={body} sampleValue={sample} />
            {usesVariable && (
              <div className="space-y-1.5">
                <Label htmlFor="tpl-sample" className="text-xs">
                  Probar {"{{1}}"} con
                </Label>
                <Input
                  id="tpl-sample"
                  placeholder={TEMPLATE_VARIABLES[0].sample}
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            )}
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
 * aparece la lista de variables disponibles (flechas + Enter/Tab insertan,
 * Escape cierra). El botón «Variable» inserta en el cursor.
 */
function BodyEditor({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  error: string | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ start: number; end: number; query: string } | null>(
    null
  );
  const [active, setActive] = useState(0);
  const alreadyUsed = countVariables(value) >= 1;

  const options: TemplateVariable[] = useMemo(() => {
    if (!menu) return [];
    const q = menu.query.toLowerCase();
    return TEMPLATE_VARIABLES.filter(
      (v) => v.key.startsWith(q) || v.label.toLowerCase().includes(q)
    );
  }, [menu]);

  function refreshMenu(next: string, cursor: number) {
    const open = findOpenVariableAtCursor(next, cursor);
    setMenu(open);
    setActive(0);
  }

  function insertVariable(v: TemplateVariable, range?: { start: number; end: number }) {
    const el = ref.current;
    const start = range?.start ?? el?.selectionStart ?? value.length;
    const end = range?.end ?? el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + v.token + value.slice(end);
    onChange(next);
    setMenu(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + v.token.length;
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
        <Label htmlFor="tpl-body">Cuerpo</Label>
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
            disabled={alreadyUsed}
            title={
              alreadyUsed
                ? "Ya usaste la única variable disponible ({{1}})"
                : "Insertar variable en el cursor"
            }
            onClick={() => insertVariable(TEMPLATE_VARIABLES[0])}
          >
            <Braces className="h-3.5 w-3.5" />
            Variable
          </Button>
        </div>
      </div>
      <div className="relative">
        <Textarea
          ref={ref}
          id="tpl-body"
          rows={4}
          placeholder="Hola {{1}}, seguimos disponibles. ¿Retomamos tu cotización?"
          value={value}
          aria-autocomplete="list"
          aria-expanded={!!menu}
          aria-controls="tpl-variable-menu"
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
            id="tpl-variable-menu"
            role="listbox"
            data-testid="template-variable-menu"
            className="absolute left-2 top-full z-20 mt-1 w-[min(100%,360px)] overflow-hidden rounded-md border border-border-strong bg-popover shadow-md"
          >
            <p className="border-b bg-subtle px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-3">
              Variables disponibles
            </p>
            {options.length === 0 && (
              <p className="px-3 py-2 text-xs text-text-3">
                Ninguna variable coincide con «{menu.query}». Solo se admite {"{{1}}"}.
              </p>
            )}
            {options.map((v, i) => {
              const used = alreadyUsed;
              return (
                <button
                  key={v.key}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  disabled={used}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => insertVariable(v, menu)}
                  className={cn(
                    "flex w-full items-start gap-3 px-3 py-2 text-left text-sm",
                    i === active && !used && "bg-accent",
                    used && "cursor-not-allowed opacity-60"
                  )}
                >
                  <code className="mt-px shrink-0 rounded bg-brand/15 px-1.5 py-0.5 font-mono text-xs text-brand-text">
                    {v.token}
                  </code>
                  <span className="min-w-0">
                    <span className="block font-medium">{v.label}</span>
                    <span className="block text-xs text-text-3">
                      {used
                        ? "Ya está en el cuerpo: v1 admite una sola variable."
                        : v.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-text-3">
          {TEMPLATE_VARIABLES[0].token} = {TEMPLATE_VARIABLES[0].label.toLowerCase()}{" "}
          (o un valor fijo al enviar).
        </p>
      )}
    </div>
  );
}
