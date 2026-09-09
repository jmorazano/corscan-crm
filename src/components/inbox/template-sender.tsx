"use client";

import { useEffect, useState } from "react";
import type { TemplateDto } from "@/lib/types";
import { originByKey, sampleValuesFor } from "@/lib/template-body";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TemplatePreview } from "@/components/templates/template-preview";

export type TemplateSendValues = {
  variable?: string;
  /** 009: un valor por binding free_text, en orden. */
  freeTexts?: string[];
};

/**
 * Selector de plantilla aprobada para conversaciones con ventana cerrada
 * (FR-005/FR-051). Sin plantillas aprobadas muestra el estado vacío.
 */
export function TemplateSender({
  conversationId,
  onSent,
  submit,
}: {
  conversationId?: string;
  onSent: () => void;
  /** Envío alternativo (004): devuelve mensaje de error o null si salió.
   * Sin esta prop, postea a la conversación (comportamiento original). */
  submit?: (
    templateId: string,
    values: TemplateSendValues
  ) => Promise<string | null>;
}) {
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [variable, setVariable] = useState("");
  const [freeTexts, setFreeTexts] = useState<Record<number, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: TemplateDto[] }) => {
        if (!cancelled) {
          setTemplates(
            (d.templates ?? []).filter((t) => t.status === "approved")
          );
        }
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (templates === null) {
    return <p className="text-xs text-muted-foreground">Cargando plantillas…</p>;
  }

  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aún no hay plantillas aprobadas. Créalas en{" "}
        <a href="/settings/templates" className="text-primary hover:underline">
          Configuración → Plantillas
        </a>{" "}
        y espera la aprobación de Meta.
      </p>
    );
  }

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  // 009: con bindings, los automáticos van solos y acá se tipean solo los
  // textos libres; legado (bindings null): la única {{1}} de siempre.
  const bindings = selected?.variableBindings ?? null;
  const freeTextSlots = bindings
    ? bindings
        .map((b, i) => ({ binding: b, index: i + 1 }))
        .filter((s) => s.binding === "free_text")
    : [];
  const needsVariable =
    bindings === null && selected
      ? /\{\{\s*1\s*\}\}/.test(selected.body)
      : false;
  const missingFreeText = freeTextSlots.some(
    (s) => !(freeTexts[s.index] ?? "").trim()
  );

  async function send() {
    if (!selected || sending) return;
    setSending(true);
    setError(null);
    const values: TemplateSendValues =
      bindings !== null
        ? { freeTexts: freeTextSlots.map((s) => (freeTexts[s.index] ?? "").trim()) }
        : { variable: needsVariable ? variable : undefined };

    if (submit) {
      const errorMessage = await submit(selected.id, values);
      setSending(false);
      if (errorMessage) {
        setError(errorMessage);
        return;
      }
    } else {
      const res = await fetch(
        `/api/conversations/${conversationId}/messages/template`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ templateId: selected.id, ...values }),
        }
      );
      setSending(false);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(data?.error?.message ?? "No se pudo enviar la plantilla");
        return;
      }
    }
    setSelectedId("");
    setVariable("");
    setFreeTexts({});
    onSent();
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="template-select">Plantilla aprobada</Label>
        <select
          id="template-select"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Elige una plantilla…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.language})
            </option>
          ))}
        </select>
      </div>
      {selected && (
        <TemplatePreview
          body={selected.body}
          headerImageUrl={selected.headerImageUrl}
          variableValues={bindings ? sampleValuesFor(bindings) : undefined}
          compact
        />
      )}
      {bindings !== null && bindings.length > 0 && (
        <div className="space-y-1.5" data-testid="sender-variables">
          <ul className="space-y-1 text-xs text-muted-foreground">
            {bindings.map((b, i) =>
              b === "free_text" ? null : (
                <li key={i} className="flex items-center gap-2">
                  <code className="rounded bg-brand/15 px-1.5 py-0.5 font-mono text-[11px] text-brand-text">
                    {`{{${i + 1}}}`}
                  </code>
                  {originByKey(b)?.label ?? b} — se completa solo
                </li>
              )
            )}
          </ul>
          {freeTextSlots.map((s) => (
            <div key={s.index} className="flex items-center gap-2">
              <code className="shrink-0 rounded bg-brand/15 px-1.5 py-0.5 font-mono text-xs text-brand-text">
                {`{{${s.index}}}`}
              </code>
              <Input
                aria-label={`Texto libre para la variable ${s.index}`}
                placeholder="texto libre"
                value={freeTexts[s.index] ?? ""}
                onChange={(e) =>
                  setFreeTexts((prev) => ({
                    ...prev,
                    [s.index]: e.target.value,
                  }))
                }
              />
            </div>
          ))}
        </div>
      )}
      {needsVariable && (
        <div className="space-y-1.5">
          <Label htmlFor="template-variable">Valor de la variable {"{{1}}"}</Label>
          <Input
            id="template-variable"
            value={variable}
            onChange={(e) => setVariable(e.target.value)}
            placeholder="p. ej. el nombre del cliente"
          />
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button
        onClick={() => void send()}
        disabled={
          !selected ||
          sending ||
          (needsVariable && !variable.trim()) ||
          missingFreeText
        }
      >
        {sending ? "Enviando…" : "Enviar plantilla"}
      </Button>
    </div>
  );
}
