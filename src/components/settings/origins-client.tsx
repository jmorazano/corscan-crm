"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TagChip } from "@/components/tags/tag-chip";
import {
  META_ADS_TAG,
  ORIGIN_PHRASE_MAX,
  originTag,
  originTagExample,
  sanitizeRuleTag,
} from "@/lib/contact-origin";

/**
 * Ajustes → Origen de contactos (043). Explica la etiqueta automática de los
 * anuncios de Meta y administra las reglas por frase de la empresa (lo que
 * no trae `referral`: Google Ads, QR, el enlace de la bio…).
 */

type Rule = {
  id: string;
  phrase: string;
  tag: string;
  appendMonth: boolean;
  createdAt: string;
};

export function OriginsSettingsClient() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [max, setMax] = useState(20);
  const [phrase, setPhrase] = useState("");
  const [tag, setTag] = useState("");
  const [appendMonth, setAppendMonth] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refetch() {
    const res = await fetch("/api/settings/origin-rules").catch(() => null);
    if (!res?.ok) {
      setRules([]);
      return;
    }
    const data = (await res.json()) as { rules: Rule[]; max: number };
    setRules(data.rules);
    setMax(data.max);
  }

  useEffect(() => {
    void refetch();
  }, []);

  async function add() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/settings/origin-rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phrase, tag, appendMonth }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo guardar la regla.");
      return;
    }
    setPhrase("");
    setTag("");
    setAppendMonth(true);
    await refetch();
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/settings/origin-rules/${id}`, { method: "DELETE" }).catch(
      () => null
    );
    if (!res?.ok) {
      setError("No se pudo borrar la regla.");
      return;
    }
    await refetch();
  }

  const metaTag = originTag(META_ADS_TAG, new Date());
  const cleanTag = sanitizeRuleTag(tag);
  const preview = cleanTag ? originTagExample({ phrase, tag, appendMonth }) : null;
  const full = rules !== null && rules.length >= max;

  return (
    <div className="max-w-2xl space-y-6 md:p-6">
      <div>
        <h2 className="font-semibold">Origen de contactos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada contacto que llega por un anuncio o un enlace se lleva una
          etiqueta con el canal y el mes. Después podés filtrarlos en
          Contactos o elegirlos en una campaña para retomar el contacto con
          una plantilla.
        </p>
      </div>

      <section className="space-y-2 rounded-md border p-4">
        <h3 className="text-sm font-medium">Anuncios de Meta (automático)</h3>
        <p className="text-sm text-muted-foreground">
          Quien toca «Enviar mensaje de WhatsApp» en un anuncio de Facebook o
          Instagram queda con la etiqueta del mes del clic, sin configurar
          nada.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Este mes:</span>
          <TagChip tag={metaTag} />
          <Link
            href={`/contacts?tags=${encodeURIComponent(metaTag)}`}
            className="text-xs text-brand-text underline-offset-2 hover:underline"
          >
            Ver contactos
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Reglas por frase</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Para lo que no avisa de dónde viene (anuncios de Google, un QR,
            el enlace de la bio): si el mensaje con el que la persona abre la
            charla contiene la frase, el contacto se lleva la etiqueta. Usá
            el mismo texto que precargás en el enlace de WhatsApp. No
            importan mayúsculas, tildes ni signos.
          </p>
        </div>

        {rules === null ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="origin-rules-empty">
            Todavía no hay reglas.
          </p>
        ) : (
          <ul className="divide-y rounded-md border" data-testid="origin-rules">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate">«{r.phrase}»</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>→</span>
                    <TagChip tag={originTagExample(r)} />
                    {r.appendMonth && <span>(cambia cada mes)</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(r.id)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                  aria-label={`Borrar la regla «${r.phrase}»`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3 rounded-md border p-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="origin-phrase">
              Si el primer mensaje contiene
            </label>
            <Input
              id="origin-phrase"
              value={phrase}
              maxLength={ORIGIN_PHRASE_MAX}
              placeholder="vi el anuncio en Google"
              onChange={(e) => setPhrase(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="origin-tag">
              Etiqueta
            </label>
            <Input
              id="origin-tag"
              value={tag}
              placeholder="google-ads"
              onChange={(e) => setTag(e.target.value)}
              className="w-60"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={appendMonth}
              onChange={(e) => setAppendMonth(e.target.checked)}
            />
            Agregar el mes a la etiqueta
          </label>
          {preview && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Va a quedar: <TagChip tag={preview} />
            </p>
          )}
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            disabled={saving || full || phrase.trim().length < 3 || !cleanTag}
            onClick={() => void add()}
          >
            {saving ? "Guardando…" : full ? `Máximo ${max} reglas` : "Agregar regla"}
          </Button>
        </div>
      </section>
    </div>
  );
}
