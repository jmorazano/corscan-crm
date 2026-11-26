"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Forward, Loader2, Search, X } from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import {
  FORWARD_MAX_TARGETS,
  forwardTargetState,
  toggleForwardTarget,
  type ForwardResult,
} from "@/lib/forward";
import { contactHandle } from "@/lib/instagram/messaging";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { ChannelIcon } from "@/components/channel-icon";
import { Dialog } from "@/components/ui/dialog";

const JSON_HEADERS = { "content-type": "application/json" };
const PAGE = 30;

/**
 * 054: «Reenviar a…». Lista las conversaciones recientes (con buscador),
 * deja elegir hasta 5 y manda. Un chat al que no se le puede escribir ahora
 * (ventana cerrada) se ve, pero no se puede elegir. El resultado es por
 * chat: si a alguno no le llegó, el diálogo queda abierto diciendo a quién
 * y por qué.
 */
export function ForwardDialog({
  open,
  sourceConversationId,
  messageIds,
  instagramHumanAgent,
  onClose,
  onDone,
}: {
  open: boolean;
  sourceConversationId: string;
  messageIds: string[];
  instagramHumanAgent: boolean;
  onClose: () => void;
  /** Se reenvió (aunque sea en parte): el padre limpia la selección. */
  onDone: (result: ForwardResult) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ConversationDto[] | null>(null);
  const [picked, setPicked] = useState<ConversationDto[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForwardResult | null>(null);
  const seqRef = useRef(0);

  // Cada apertura empieza limpia.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setPicked([]);
    setHint(null);
    setError(null);
    setResult(null);
    setSending(false);
  }, [open]);

  // Recientes + búsqueda (con un respiro para no pedir en cada tecla).
  useEffect(() => {
    if (!open) return;
    const seq = ++seqRef.current;
    const timer = window.setTimeout(
      async () => {
        const qs = new URLSearchParams({ limit: String(PAGE) });
        if (q.trim()) qs.set("q", q.trim());
        const res = await fetch(`/api/conversations?${qs}`).catch(() => null);
        if (seq !== seqRef.current) return;
        if (!res?.ok) {
          setRows([]);
          return;
        }
        const data = (await res.json()) as { conversations: ConversationDto[] };
        if (seq !== seqRef.current) return;
        setRows(data.conversations.filter((c) => c.kind !== "trainer"));
      },
      q.trim() ? 250 : 0
    );
    return () => window.clearTimeout(timer);
  }, [open, q]);

  const pickedIds = picked.map((c) => c.id);

  function toggle(c: ConversationDto) {
    const next = toggleForwardTarget(pickedIds, c.id);
    if (next.full) {
      setHint(`Podés reenviar a ${FORWARD_MAX_TARGETS} chats como máximo por vez`);
      return;
    }
    setHint(null);
    setPicked((prev) =>
      prev.some((p) => p.id === c.id) ? prev.filter((p) => p.id !== c.id) : [...prev, c]
    );
  }

  async function submit() {
    if (picked.length === 0 || sending) return;
    setSending(true);
    setError(null);
    const res = await fetch("/api/conversations/forward", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        sourceConversationId,
        messageIds,
        targetConversationIds: pickedIds,
      }),
    }).catch(() => null);
    setSending(false);
    if (!res) {
      setError("Sin conexión con el servidor");
      return;
    }
    const data = (await res.json().catch(() => null)) as
      | (ForwardResult & { error?: { message?: string } })
      | null;
    if (!res.ok || !data || !Array.isArray(data.targets)) {
      setError(data?.error?.message ?? "No se pudo reenviar");
      return;
    }
    if (data.sent > 0) onDone(data);
    if (data.failed > 0) {
      // Queda abierto: hay que decir a quién no le llegó.
      setResult(data);
      return;
    }
    onClose();
  }

  const count = messageIds.length;
  const title = count === 1 ? "Reenviar mensaje a…" : `Reenviar ${count} mensajes a…`;

  // Las dos vistas devuelven un <Dialog> en la misma posición: React conserva
  // la instancia (y, en el celular, su entrada en el historial).
  if (result) {
    const failed = result.targets.filter((t) => t.failed > 0);
    const reached = result.targets.filter((t) => t.sent > 0);
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title={result.sent > 0 ? "Se reenvió, pero no a todos" : "No se pudo reenviar"}
        size="md"
        testId="forward-dialog"
        footer={
          <button
            type="button"
            onClick={onClose}
            data-testid="forward-result-close"
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90"
          >
            Entendido
          </button>
        }
      >
        <div data-testid="forward-result">
        {reached.length > 0 && (
          <p className="mb-3 flex items-start gap-2 text-sm text-text-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" strokeWidth={2} />
            <span>Llegó a {reached.map((t) => t.name).join(", ")}.</span>
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {failed.map((t) => (
            <li
              key={t.conversationId}
              data-testid="forward-failed-target"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-sm"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" strokeWidth={1.8} />
              <span className="min-w-0">
                <span className="font-medium">{t.name}</span>
                <span className="text-text-2">
                  {" — "}
                  {t.sent > 0
                    ? `${t.failed} de ${t.sent + t.failed} no ${t.failed === 1 ? "salió" : "salieron"}`
                    : "no se envió"}
                  {t.error ? `: ${t.error}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      testId="forward-dialog"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-xs text-text-3" data-testid="forward-count">
            {picked.length} de {FORWARD_MAX_TARGETS} chats
          </span>
          <button
            type="button"
            disabled={picked.length === 0 || sending}
            onClick={() => void submit()}
            data-testid="forward-submit"
            className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            ) : (
              <Forward className="h-4 w-4" strokeWidth={1.8} />
            )}
            {sending ? "Reenviando…" : "Reenviar"}
          </button>
        </div>
      }
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
          strokeWidth={1.7}
        />
        <input
          data-autofocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar un chat por nombre o teléfono"
          aria-label="Buscar un chat"
          data-testid="forward-search"
          className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
        />
      </div>

      {picked.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5" data-testid="forward-picked">
          {picked.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c)}
              title="Quitar"
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand-soft bg-brand-tint py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-brand-text"
            >
              <span className="truncate">{c.contact.name}</span>
              <X className="h-3 w-3 shrink-0" strokeWidth={2} />
            </button>
          ))}
        </div>
      )}
      {hint && (
        <p className="mt-2 text-xs text-[#8a6d3b]" role="status" data-testid="forward-hint">
          {hint}
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-destructive" role="alert" data-testid="forward-error">
          {error}
        </p>
      )}

      <ul className="-mx-1 mt-2.5 flex max-h-[46dvh] min-h-[180px] flex-col overflow-y-auto md:max-h-[340px]">
        {rows === null ? (
          <li className="flex items-center justify-center gap-2 py-8 text-sm text-text-3">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} /> Cargando chats…
          </li>
        ) : rows.length === 0 ? (
          <li className="py-8 text-center text-sm text-text-3" data-testid="forward-empty">
            {q.trim() ? "Ningún chat coincide con la búsqueda" : "Todavía no hay conversaciones"}
          </li>
        ) : (
          rows.map((c) => {
            const state = forwardTargetState(c, new Date(), { instagramHumanAgent });
            const checked = pickedIds.includes(c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={!state.ok || sending}
                  onClick={() => toggle(c)}
                  role="checkbox"
                  aria-checked={checked}
                  data-testid="forward-target"
                  data-conversation-id={c.id}
                  data-available={state.ok ? "1" : "0"}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
                    state.ok ? "hover:bg-accent" : "cursor-not-allowed opacity-55",
                    checked && "bg-brand-tint"
                  )}
                >
                  <ContactAvatar name={c.contact.name} seed={c.contact.id} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{c.contact.name}</span>
                      {c.kind === "instagram" && <ChannelIcon channel="instagram" />}
                    </span>
                    <span className="block truncate text-xs text-text-3">
                      {state.ok ? contactHandle(c.contact) : state.reason}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      checked ? "border-brand bg-brand text-white" : "border-border-strong",
                      !state.ok && "invisible"
                    )}
                  >
                    {checked && <Check className="h-3.5 w-3.5" strokeWidth={2.4} />}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </Dialog>
  );
}
