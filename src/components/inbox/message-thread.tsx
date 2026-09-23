"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  Loader2,
  Mic,
  Paperclip,
  Sparkles,
} from "lucide-react";
import type { MessageDto } from "@/lib/types";
import { formatElapsed } from "@/lib/audio-record";
import { friendlyDeliveryError } from "@/lib/meta-errors";
import { cn } from "@/lib/utils";
import { useLongPress } from "@/components/gestures";
import { ActionSheet } from "@/components/ui/action-sheet";
import { mediaLabel } from "./helpers";

function StatusTicks({
  status,
  error,
}: {
  status: MessageDto["status"];
  error?: string | null;
}) {
  const cls = "h-[13px] w-[13px]";
  if (status === "pending") return <Clock3 className={cn(cls, "text-text-4")} strokeWidth={1.7} />;
  if (status === "sent") return <Check className={cn(cls, "text-text-4")} strokeWidth={1.7} />;
  if (status === "delivered")
    return <CheckCheck className={cn(cls, "text-text-4")} strokeWidth={1.7} />;
  if (status === "read")
    return <CheckCheck className={cn(cls, "text-brand")} strokeWidth={1.7} />;
  // 010: el ⚠ dice POR QUÉ (tooltip + accesible); la línea completa va bajo
  // la burbuja porque en mobile no hay hover.
  const reason = friendlyDeliveryError(error) ?? "El mensaje no se pudo entregar";
  return (
    <span title={reason} aria-label={`No entregado: ${reason}`} role="img">
      <AlertTriangle
        className={cn(cls, "text-destructive")}
        strokeWidth={1.7}
      />
    </span>
  );
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
}

function bubbleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Copia con el portapapeles moderno o, si no está (contexto inseguro), con `execCommand`. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // seguimos con el fallback
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Umbral para considerar que el operador está «al final» del hilo. */
const NEAR_BOTTOM_PX = 80;

export function MessageThread({
  messages,
  kind = "whatsapp",
  thinkingLabel = null,
}: {
  messages: MessageDto[];
  /** 015: en el hilo del entrenador no hay ticks de entrega ni etiquetas de API. */
  kind?: "whatsapp" | "trainer";
  /** 015: «{agente} está pensando…» mientras se espera la respuesta. */
  thinkingLabel?: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const prevRef = useRef<{ count: number; firstId: string | null }>({
    count: 0,
    firstId: null,
  });
  const [showJump, setShowJump] = useState(false);
  const [pendingNew, setPendingNew] = useState(0);
  const [sheetMsg, setSheetMsg] = useState<MessageDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    atBottomRef.current = true;
    setShowJump(false);
    setPendingNew(0);
  }, []);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = dist < NEAR_BOTTOM_PX;
    atBottomRef.current = atBottom;
    setShowJump(!atBottom);
    if (atBottom) setPendingNew(0);
  }

  // 012 (FR-009): al abrir un hilo va al final; después solo sigue al final
  // si el operador ya estaba ahí (o si el saliente es suyo). Si subió a leer
  // historia, los entrantes nuevos se cuentan en el botón «↓».
  useEffect(() => {
    const firstId = messages[0]?.id ?? null;
    const prev = prevRef.current;
    const switched = prev.count === 0 || firstId !== prev.firstId;
    const added = messages.length - prev.count;
    prevRef.current = { count: messages.length, firstId };
    if (messages.length === 0) return;
    if (switched) {
      scrollToBottom();
      return;
    }
    if (added <= 0) return;
    const last = messages[messages.length - 1];
    // Lo que envía el operador lo sigue; lo que responde la IA cuenta como
    // «nuevo» igual que un entrante: no lo arrastra mientras lee historia.
    const ownSend = last?.direction === "out" && !last.aiGenerated;
    if (atBottomRef.current || ownSend) scrollToBottom(true);
    else setPendingNew((n) => n + added);
  }, [messages, scrollToBottom]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        data-testid="message-thread"
        className="flex flex-1 flex-col gap-[3px] overflow-y-auto overscroll-y-contain bg-chat px-3 py-4 md:px-[6%] md:py-5"
      >
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay =
            !prev ||
            new Date(prev.createdAt).toDateString() !==
              new Date(m.createdAt).toDateString();
          const grouped =
            !newDay && prev !== undefined && prev.direction === m.direction;
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full border bg-background px-3 py-1 text-[11.5px] font-semibold text-text-2 shadow-sm">
                    {dayLabel(m.createdAt)}
                  </span>
                </div>
              )}
              <Bubble
                message={m}
                kind={kind}
                grouped={grouped}
                onLongPress={() => setSheetMsg(m)}
              />
            </div>
          );
        })}
        {thinkingLabel && (
          <div className="mt-2.5 flex justify-start" data-testid="trainer-thinking">
            <div className="flex items-center gap-2 rounded-lg rounded-tl-[5px] bg-background px-3 py-2 text-sm text-text-3 shadow-sm">
              <span className="flex items-center gap-[3px]" aria-hidden>
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-3 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-3 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-3" />
              </span>
              {thinkingLabel}
            </div>
          </div>
        )}
      </div>

      {showJump && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          aria-label={
            pendingNew > 0
              ? `Ir al final (${pendingNew} mensajes nuevos)`
              : "Ir al final"
          }
          data-testid="jump-to-bottom"
          className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full border bg-background text-text-2 shadow-md transition-colors hover:text-foreground md:bottom-4 md:right-4"
        >
          <ArrowDown className="h-4 w-4" strokeWidth={1.8} />
          {pendingNew > 0 && (
            <span
              data-testid="jump-pending"
              className="absolute -right-1 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10.5px] font-semibold text-white"
            >
              {pendingNew}
            </span>
          )}
        </button>
      )}

      {notice && (
        <p
          role="status"
          className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border bg-background px-3 py-1 text-xs font-medium shadow-sm"
        >
          {notice}
        </p>
      )}

      <ActionSheet
        open={sheetMsg !== null}
        onClose={() => setSheetMsg(null)}
        title="Mensaje"
        testId="message-sheet"
        actions={[
          {
            key: "copy",
            label: "Copiar texto",
            icon: Copy,
            disabled: !sheetMsg?.text,
            onSelect: async () => {
              const ok = await copyText(sheetMsg?.text ?? "");
              setNotice(ok ? "Copiado" : "No se pudo copiar");
              window.setTimeout(() => setNotice(null), 1600);
            },
          },
        ]}
      />
    </div>
  );
}

/**
 * Nota de voz (015): reproductor + transcripción con estados. `status`
 * es el estado de la transcripción, no de la entrega.
 */
function AudioNote({ message: m }: { message: MessageDto }) {
  const media = m.media!;
  return (
    <div className="min-w-[220px]" data-testid="audio-message" data-status={m.status}>
      <div className="flex items-center gap-2">
        <audio
          controls
          preload="none"
          src={media.url}
          data-testid="audio-player"
          className="h-9 w-full max-w-[260px]"
        />
        {media.durationMs !== null && (
          <span className="shrink-0 text-[11px] text-text-3">
            {formatElapsed(media.durationMs)}
          </span>
        )}
      </div>
      <div
        data-testid="audio-transcription"
        className={cn(
          "mt-1.5 flex items-start gap-1.5 border-t border-brand-soft/60 pt-1.5 text-[13px] leading-snug",
          m.status === "failed" ? "text-destructive" : "text-text-2"
        )}
      >
        {m.status === "pending" ? (
          <>
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.7} />
            <span>Transcribiendo…</span>
          </>
        ) : m.status === "failed" ? (
          <>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
            <span>{m.error ?? "No pude transcribir el audio"}</span>
          </>
        ) : (
          <>
            <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={1.7} />
            <span className="whitespace-pre-wrap break-words">{m.text}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Bubble({
  message: m,
  kind,
  grouped,
  onLongPress,
}: {
  message: MessageDto;
  kind: "whatsapp" | "trainer";
  grouped: boolean;
  onLongPress: () => void;
}) {
  const { handlers } = useLongPress(onLongPress);
  const out = m.direction === "out";
  const wa = kind === "whatsapp";
  return (
    <div
      className={cn(
        "flex",
        out ? "justify-end" : "justify-start",
        grouped ? "mt-[3px]" : "mt-2.5"
      )}
    >
      <div
        {...handlers}
        data-message-id={m.id}
        className={cn(
          "no-callout max-w-[85%] rounded-lg px-3 pb-1.5 pt-2 text-sm leading-[1.45] shadow-sm max-md:select-none md:max-w-[64%]",
          out
            ? "border border-brand-soft bg-bubble-out text-bubble-out-text"
            : "bg-background",
          !grouped && (out ? "rounded-tr-[5px]" : "rounded-tl-[5px]")
        )}
      >
        {m.type === "text" || m.type === "template" ? (
          <span className="whitespace-pre-wrap break-words">{m.text}</span>
        ) : m.type === "audio" && m.media ? (
          <AudioNote message={m} />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-text-3">
            <Paperclip className="h-3.5 w-3.5" strokeWidth={1.7} />
            {mediaLabel(m.type)}
            {m.text ? ` — ${m.text}` : ""}
          </span>
        )}
        <span className="float-right ml-2 mt-1 flex items-center gap-1">
          {m.aiGenerated && (
            <span
              data-testid="message-ai-chip"
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-brand"
              title="Respuesta generada por IA"
            >
              <Sparkles className="h-3 w-3" strokeWidth={1.7} /> IA
            </span>
          )}
          <span className="text-[10.5px] text-text-4">{bubbleTime(m.createdAt)}</span>
          {out && wa && <StatusTicks status={m.status} error={m.error} />}
        </span>
        {out && wa && m.source === "phone" && (
          <span
            data-testid="message-from-phone"
            className="mt-1.5 block clear-both border-t border-brand-soft/60 pt-1 text-[11px] leading-snug text-text-3"
            title="Lo mandaste desde la app de WhatsApp del celular"
          >
            Desde el celular
          </span>
        )}
        {out && wa && m.via?.kind === "api" && (
          <span
            data-testid="message-via-api"
            className="mt-1.5 block clear-both border-t border-brand-soft/60 pt-1 text-[11px] leading-snug text-text-3"
            title="Notificación enviada por el sistema integrado de la empresa"
          >
            Enviado por API · {m.via.label}
          </span>
        )}
        {out && wa && m.status === "failed" && (
          <span
            data-testid="message-fail-reason"
            className="mt-1.5 block clear-both border-t border-destructive/20 pt-1 text-[11px] leading-snug text-destructive"
          >
            No entregado:{" "}
            {friendlyDeliveryError(m.error) ?? "el canal no informó el motivo"}
          </span>
        )}
      </div>
    </div>
  );
}
