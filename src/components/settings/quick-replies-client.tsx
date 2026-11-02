"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pencil, Search, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  NAME_PLACEHOLDER,
  QUICK_REPLY_BODY_MAX,
  QUICK_REPLY_SHORTCUT_MAX,
  filterQuickPicks,
  renderQuickReply,
  sanitizeShortcut,
  type QuickReplyDto,
} from "@/lib/quick-replies";

/**
 * Ajustes → Respuestas rápidas (047). Atajo + texto por empresa, sin pasar
 * por Meta; las administra todo el equipo. En la Bandeja salen con el rayo o
 * escribiendo `/` en la caja de texto.
 */
export function QuickRepliesSettingsClient() {
  const [replies, setReplies] = useState<QuickReplyDto[] | null>(null);
  const [max, setMax] = useState(200);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState("");
  const [body, setBody] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  // Cursor a restaurar DESPUÉS de que React escriba el texto nuevo (si no,
  // el valor controlado lo manda al final o al principio).
  const pendingCursor = useRef<number | null>(null);

  useLayoutEffect(() => {
    const pos = pendingCursor.current;
    if (pos === null) return;
    pendingCursor.current = null;
    bodyRef.current?.focus();
    bodyRef.current?.setSelectionRange(pos, pos);
  }, [body]);

  async function refetch() {
    const res = await fetch("/api/quick-replies").catch(() => null);
    if (!res?.ok) {
      setReplies([]);
      return;
    }
    const data = (await res.json()) as { replies: QuickReplyDto[]; max: number };
    setReplies(data.replies);
    setMax(data.max);
  }

  useEffect(() => {
    void refetch();
  }, []);

  function resetForm() {
    setEditingId(null);
    setShortcut("");
    setBody("");
    setError(null);
  }

  function startEdit(r: QuickReplyDto) {
    setEditingId(r.id);
    setShortcut(r.shortcut);
    setBody(r.body);
    setError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setTimeout(() => bodyRef.current?.focus(), 0);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(editingId ? `/api/quick-replies/${editingId}` : "/api/quick-replies", {
      method: editingId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortcut, body }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo guardar la respuesta rápida.");
      return;
    }
    resetForm();
    await refetch();
  }

  async function remove(r: QuickReplyDto) {
    if (!window.confirm(`¿Borrar la respuesta rápida /${r.shortcut}?`)) return;
    setError(null);
    const res = await fetch(`/api/quick-replies/${r.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo borrar la respuesta rápida.");
      return;
    }
    if (editingId === r.id) resetForm();
    await refetch();
  }

  function insertName() {
    const ta = bodyRef.current;
    const start = ta?.selectionStart ?? body.length;
    const end = ta?.selectionEnd ?? body.length;
    pendingCursor.current = start + NAME_PLACEHOLDER.length;
    setBody(body.slice(0, start) + NAME_PLACEHOLDER + body.slice(end));
  }

  const cleanShortcut = sanitizeShortcut(shortcut);
  const visible = useMemo(
    () =>
      filterQuickPicks(
        (replies ?? []).map((r) => ({ ...r, key: r.shortcut })),
        query
      ),
    [replies, query]
  );
  const full = !editingId && replies !== null && replies.length >= max;
  const tooLong = body.trim().length > QUICK_REPLY_BODY_MAX;

  return (
    <div className="max-w-2xl space-y-6 md:p-6">
      <div>
        <h2 className="font-semibold">Respuestas rápidas</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Textos que usás seguido, con un atajo. En la Bandeja escribí{" "}
          <code className="rounded bg-subtle px-1 text-xs">/</code> y el atajo
          (o tocá el <Zap className="inline h-3.5 w-3.5 align-[-2px]" strokeWidth={2} />)
          y el texto queda en la caja para revisarlo antes de enviar. No pasan
          por Meta: se usan al instante, en WhatsApp e Instagram, dentro de la
          ventana de 24 horas. Las ve y las edita todo el equipo.
        </p>
      </div>

      <div ref={formRef} className="space-y-3 rounded-md border p-4" data-testid="quick-reply-form">
        <h3 className="text-sm font-medium">
          {editingId ? "Editar respuesta rápida" : "Nueva respuesta rápida"}
        </h3>
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="qr-shortcut">
            Atajo
          </label>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground">/</span>
            <Input
              id="qr-shortcut"
              value={shortcut}
              maxLength={QUICK_REPLY_SHORTCUT_MAX + 5}
              placeholder="seña"
              autoComplete="off"
              onChange={(e) => setShortcut(e.target.value)}
              className="w-60"
            />
          </div>
          {shortcut && cleanShortcut !== shortcut.trim().replace(/^\/+/, "") && (
            <p className="text-xs text-muted-foreground">
              Va a quedar: <code className="rounded bg-subtle px-1">/{cleanShortcut || "…"}</code>
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-end justify-between gap-2">
            <label className="text-sm font-medium" htmlFor="qr-body">
              Texto
            </label>
            <button
              type="button"
              // El mousedown no le saca el foco (ni la selección) a la caja.
              onMouseDown={(e) => e.preventDefault()}
              onClick={insertName}
              className="rounded-full border bg-secondary px-2.5 py-0.5 text-xs font-medium text-text-2 hover:border-brand-soft hover:bg-brand-tint hover:text-brand-text"
            >
              + Nombre del contacto
            </button>
          </div>
          <Textarea
            id="qr-body"
            ref={bodyRef}
            value={body}
            rows={5}
            placeholder={`Hola ${NAME_PLACEHOLDER}! Para confirmar la reserva te pedimos una seña del 30 %…`}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex justify-between gap-2 text-xs text-muted-foreground">
            <span>
              <code className="rounded bg-subtle px-1">{NAME_PLACEHOLDER}</code> se
              reemplaza por el primer nombre del contacto.
            </span>
            <span className={tooLong ? "text-destructive" : undefined}>
              {body.trim().length}/{QUICK_REPLY_BODY_MAX}
            </span>
          </div>
          {body.includes(NAME_PLACEHOLDER) && (
            <p className="whitespace-pre-wrap rounded-md bg-subtle px-3 py-2 text-xs text-text-2">
              Con María: {renderQuickReply(body.trim(), "María Pérez")}
            </p>
          )}
        </div>
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            disabled={saving || full || !cleanShortcut || !body.trim() || tooLong}
            onClick={() => void save()}
          >
            {saving
              ? "Guardando…"
              : full
                ? `Máximo ${max} respuestas`
                : editingId
                  ? "Guardar cambios"
                  : "Crear respuesta rápida"}
          </Button>
          {editingId && (
            <Button variant="outline" onClick={resetForm}>
              Cancelar
            </Button>
          )}
        </div>
      </div>

      <section className="space-y-3">
        {replies !== null && replies.length > 6 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              placeholder="Buscar por atajo o texto"
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        )}
        {replies === null ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : replies.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="quick-replies-empty">
            Todavía no hay respuestas rápidas.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin coincidencias.</p>
        ) : (
          <ul className="divide-y rounded-md border" data-testid="quick-replies-list">
            {visible.map((r) => (
              <li
                key={r.id}
                className="flex items-start gap-3 px-3 py-2.5 text-sm"
                data-testid={`quick-reply-row-${r.shortcut}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">/{r.shortcut}</p>
                  <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-text-3">{r.body}</p>
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(r)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Editar /${r.shortcut}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void remove(r)}
                  className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                  aria-label={`Borrar /${r.shortcut}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
