"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  CircleDashed,
  CheckCheck,
  Clock3,
  Copy,
  Download,
  FileText,
  Film,
  Loader2,
  MessageCircle,
  Mic,
  Info,
  PauseCircle,
  Paperclip,
  RotateCw,
  Sparkles,
  UserRound,
  CheckCircle2,
} from "lucide-react";
import type { MessageDto } from "@/lib/types";
import { eventText, type ConversationEventDto, type EventTone } from "@/lib/conversation-events";
import { linkifyParts } from "@/lib/linkify";
import { formatFileSize, formatLabel, OUTBOUND_KINDS } from "@/lib/outbound-media";
import { formatElapsed } from "@/lib/audio-record";
import { friendlyDeliveryError } from "@/lib/meta-errors";
import { cn } from "@/lib/utils";
import { useLongPress } from "@/components/gestures";
import { ActionSheet } from "@/components/ui/action-sheet";
import { Dialog } from "@/components/ui/dialog";
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

type ThreadItem =
  | { kind: "message"; id: string; createdAt: string; message: MessageDto }
  | { kind: "event"; id: string; createdAt: string; event: ConversationEventDto };

/**
 * 031: mensajes y líneas de evento en un solo hilo, por hora. Los mensajes
 * conservan su orden (el del servidor); cada evento entra antes del primer
 * mensaje posterior a él.
 */
function mergeThread(messages: MessageDto[], events: ConversationEventDto[]): ThreadItem[] {
  const sorted = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const items: ThreadItem[] = [];
  let e = 0;
  for (const m of messages) {
    const at = new Date(m.createdAt).getTime();
    while (e < sorted.length && new Date(sorted[e]!.createdAt).getTime() < at) {
      const ev = sorted[e++]!;
      items.push({ kind: "event", id: ev.id, createdAt: ev.createdAt, event: ev });
    }
    items.push({ kind: "message", id: m.id, createdAt: m.createdAt, message: m });
  }
  while (e < sorted.length) {
    const ev = sorted[e++]!;
    items.push({ kind: "event", id: ev.id, createdAt: ev.createdAt, event: ev });
  }
  return items;
}

export function MessageThread({
  messages,
  events = [],
  kind = "whatsapp",
  thinkingLabel = null,
  onRetry,
}: {
  messages: MessageDto[];
  /** 031: qué pasó con la IA en este chat (líneas grises entre los mensajes). */
  events?: ConversationEventDto[];
  /** 015: en el hilo del entrenador no hay ticks de entrega ni etiquetas de API. */
  kind?: "whatsapp" | "trainer" | "instagram";
  /** 015: «{agente} está pensando…» mientras se espera la respuesta. */
  thinkingLabel?: string | null;
  /** 026: reintenta un adjunto fallido; devuelve un error o null. */
  onRetry?: (messageId: string) => Promise<string | null>;
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

  function keepPinned() {
    if (atBottomRef.current) scrollToBottom();
  }

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
    if (added <= 0) {
      // 026: un mensaje que CRECE (la línea «No entregado», una
      // transcripción) no agrega filas: si el operador estaba al final, lo
      // sigue estando.
      if (atBottomRef.current) scrollToBottom();
      return;
    }
    const last = messages[messages.length - 1];
    // Lo que envía el operador lo sigue; lo que responde la IA cuenta como
    // «nuevo» igual que un entrante: no lo arrastra mientras lee historia.
    const ownSend = last?.direction === "out" && !last.aiGenerated;
    if (atBottomRef.current || ownSend) scrollToBottom(true);
    else setPendingNew((n) => n + added);
  }, [messages, scrollToBottom]);

  // 031: una línea nueva de la IA sigue al final si el operador ya estaba ahí.
  useEffect(() => {
    if (events.length > 0 && atBottomRef.current) scrollToBottom(true);
  }, [events.length, scrollToBottom]);

  const items = mergeThread(messages, events);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        // 026: una imagen o un video que termina de cargar agranda el hilo
        // sin disparar `scroll`: si el operador estaba al final, lo sigue.
        onLoadCapture={keepPinned}
        onLoadedMetadataCapture={keepPinned}
        data-testid="message-thread"
        className="flex flex-1 flex-col gap-[3px] overflow-y-auto overscroll-y-contain bg-chat px-3 py-4 md:px-[6%] md:py-5"
      >
        {items.map((item, i) => {
          const prev = items[i - 1];
          const newDay =
            !prev ||
            new Date(prev.createdAt).toDateString() !==
              new Date(item.createdAt).toDateString();
          const dayChip = newDay && (
            <div className="my-3 flex justify-center">
              <span className="rounded-full border bg-background px-3 py-1 text-[11.5px] font-semibold text-text-2 shadow-sm">
                {dayLabel(item.createdAt)}
              </span>
            </div>
          );
          if (item.kind === "event") {
            return (
              <div key={item.id}>
                {dayChip}
                <ThreadEvent event={item.event} />
              </div>
            );
          }
          const m = item.message;
          const grouped =
            !newDay &&
            prev !== undefined &&
            prev.kind === "message" &&
            prev.message.direction === m.direction;
          return (
            <div key={m.id}>
              {dayChip}
              <Bubble
                message={m}
                kind={kind}
                grouped={grouped}
                onLongPress={() => setSheetMsg(m)}
                onRetry={onRetry}
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
 * 031: el texto con sus enlaces clicables (los del agente, los que pega el
 * equipo y los que manda el cliente). Se abren en otra pestaña y sin pasar
 * el CRM como referente: el enlace lo escribió un tercero.
 */
function Linkified({ text }: { text: string | null | undefined }) {
  const parts = linkifyParts(text);
  return (
    <>
      {parts.map((p, i) =>
        p.type === "link" ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            data-testid="message-link"
            className="break-all text-[#027eb5] underline underline-offset-2 hover:text-[#01628c]"
            onClick={(e) => e.stopPropagation()}
          >
            {p.value}
          </a>
        ) : (
          <span key={i}>{p.value}</span>
        )
      )}
    </>
  );
}

/** 031: «HH:MM», o con el día si no es hoy (la ventana puede cruzar la medianoche). */
function untilLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  if (d.toDateString() === today.toDateString()) return bubbleTime(iso);
  if (d.toDateString() === tomorrow.toDateString()) return `${bubbleTime(iso)} de mañana`;
  return `${bubbleTime(iso)} del ${d.toLocaleDateString("es-MX", { day: "numeric", month: "short" })}`;
}

const EVENT_TONE: Record<EventTone, string> = {
  neutral: "border-border bg-background/90 text-text-2",
  brand: "border-brand-soft bg-brand-tint text-brand-text",
  warning: "border-[#ece2cf] bg-[#faf7f0] text-[#8a6d3b]",
  error: "border-destructive/30 bg-destructive/5 text-destructive",
};

/**
 * 031: una línea del hilo que NO es un mensaje: quién prendió o apagó la IA,
 * por qué no respondió, cuándo retomó, qué falló. Si la respuesta de la IA no
 * salió, se puede ver (y copiar) lo que iba a decir.
 */
function ThreadEvent({ event }: { event: ConversationEventDto }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { text, tone } = eventText(event, untilLabel);
  const Icon =
    event.kind === "ai_toggled"
      ? event.reason === "paused"
        ? PauseCircle
        : Sparkles
      : event.kind === "ai_resumed"
        ? Sparkles
        : event.kind === "ai_handoff"
          ? UserRound
          : event.kind === "ai_error"
            ? AlertTriangle
            : event.kind === "ai_tool_write"
              ? CheckCircle2
              : Info;
  const pending = event.details?.text ?? null;
  return (
    <div
      className="my-2 flex justify-center px-1"
      data-testid="thread-event"
      data-kind={event.kind}
      data-reason={event.reason ?? ""}
    >
      <div
        className={cn(
          "max-w-[94%] rounded-lg border px-2.5 py-1.5 text-[12px] leading-snug shadow-sm md:max-w-[80%]",
          EVENT_TONE[tone]
        )}
      >
        <p className="flex items-start gap-1.5">
          <Icon className="mt-[1px] h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
          <span>
            {text}
            <span className="ml-1 whitespace-nowrap opacity-70">· {bubbleTime(event.createdAt)}</span>
          </span>
        </p>
        {pending && (
          <div className="mt-1 pl-5">
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => setOpen((v) => !v)}
              data-testid="thread-event-toggle"
            >
              {open ? "Ocultar lo que iba a decir" : "Ver lo que iba a decir"}
            </button>
            {open && (
              <div className="mt-1 rounded-md border bg-background p-2 text-left text-[12.5px] text-foreground">
                <p className="whitespace-pre-wrap break-words" data-testid="thread-event-text">
                  <Linkified text={pending} />
                </p>
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-medium text-text-2 hover:text-foreground"
                  onClick={async () => {
                    setCopied(await copyText(pending));
                    window.setTimeout(() => setCopied(false), 1600);
                  }}
                >
                  <Copy className="h-3 w-3" strokeWidth={1.8} /> {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Nota de voz (015): reproductor + transcripción con estados. `status`
 * es el estado de la transcripción, no de la entrega.
 */
function AudioNote({ message: m, plain = false }: { message: MessageDto; plain?: boolean }) {
  // 020: `mediaState` (no `status`) — en un entrante `status` ya vale
  // "delivered" desde la ingesta y no puede contar dos historias.
  const state = m.mediaState ?? (m.text ? "ready" : "pending");
  const media = m.media;
  // 026: un audio que mandó el equipo: el reproductor. 027: con su
  // duración y, si la empresa tiene IA, la transcripción (un fallo no se
  // muestra: el audio ya salió y es del propio equipo).
  if (plain && media) {
    return (
      <div className="min-w-[220px]" data-testid="audio-message" data-status="sent">
        <div className="flex items-center gap-2">
          <audio
            controls
            preload="none"
            src={media.url}
            data-testid="audio-player"
            className="h-9 w-full max-w-[260px]"
          />
          {media.durationMs !== null && (
            <span className="shrink-0 text-[11px] text-text-3" data-testid="audio-duration">
              {formatElapsed(media.durationMs)}
            </span>
          )}
        </div>
        {(m.mediaState === "pending" || m.text) && (
          <div
            data-testid="audio-transcription"
            data-status={m.mediaState === "pending" ? "pending" : "ready"}
            className="mt-1.5 flex items-start gap-1.5 border-t border-brand-soft/60 pt-1.5 text-[13px] leading-snug text-text-2"
          >
            {m.mediaState === "pending" ? (
              <>
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.7} />
                <span>Transcribiendo…</span>
              </>
            ) : (
              <>
                <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={1.7} />
                <span className="whitespace-pre-wrap break-words">{m.text}</span>
              </>
            )}
          </div>
        )}
      </div>
    );
  }
  // Sin binario (la descarga falló) no hay reproductor, pero el equipo tiene
  // que ver que el cliente mandó un audio y por qué no se pudo leer.
  if (!media) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-text-3"
        data-testid="audio-message"
        data-status={state}
      >
        <Mic className="h-3.5 w-3.5" strokeWidth={1.7} />
        {state === "pending" ? "Descargando nota de voz…" : "Nota de voz"}
        {state === "failed" && m.error ? ` — ${m.error}` : ""}
      </span>
    );
  }
  return (
    <div className="min-w-[220px]" data-testid="audio-message" data-status={state}>
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
          state === "failed" ? "text-destructive" : "text-text-2"
        )}
      >
        {state === "pending" ? (
          <>
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.7} />
            <span>Transcribiendo…</span>
          </>
        ) : state === "failed" ? (
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

/**
 * Imagen que mandó el cliente (020). Antes de esta feature la bandeja
 * mostraba un clip que decía «Imagen» y nada más: el comprobante de una
 * transferencia era invisible para el equipo, que es justamente quien tiene
 * que verlo para dar de alta la reserva.
 */
function ImageAttachment({ message: m, kind }: { message: MessageDto; kind: "whatsapp" | "trainer" | "instagram" }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const media = m.media;
  const state = m.mediaState;
  // 022: en el hilo del entrenador la imagen la manda el DUEÑO y el agente
  // la LEE (la lectura puede ser larga: una lista de precios entera).
  const ownerImage = kind === "trainer" && m.direction === "out";
  // 026: la que mandó el equipo a un cliente.
  const sentImage = kind !== "trainer" && m.direction === "out";
  const alt = ownerImage
    ? "Imagen que le mandaste a tu agente"
    : sentImage
      ? "Imagen enviada"
      : "Imagen enviada por el cliente";

  if (!media) {
    return (
      <span className="inline-flex items-center gap-1.5 text-text-3">
        <Paperclip className="h-3.5 w-3.5" strokeWidth={1.7} />
        {state === "pending" ? "Descargando imagen…" : "Imagen no disponible"}
        {state === "failed" && m.error ? ` — ${m.error}` : ""}
      </span>
    );
  }

  const summary = m.mediaSummary?.trim() ?? "";
  const long = summary.length > 280;
  const shown = long && !expanded ? `${summary.slice(0, 280).trimEnd()}…` : summary;

  return (
    <div className="min-w-[180px]" data-testid="image-message" data-status={state ?? "ready"}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block overflow-hidden rounded-md border border-brand-soft/60"
        data-testid="image-thumb"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media.url}
          alt={summary || alt}
          className="max-h-[240px] w-full max-w-[260px] object-cover"
          loading="lazy"
        />
      </button>
      {m.text && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-[1.45]">
          <Linkified text={m.text} />
        </p>
      )}
      {ownerImage && state === "pending" && (
        <div
          data-testid="image-reading"
          className="mt-1.5 flex items-center gap-1.5 border-t border-brand-soft/60 pt-1.5 text-[12px] text-text-3"
        >
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.7} />
          <span>Leyendo la imagen…</span>
        </div>
      )}
      {ownerImage && state === "failed" && (
        <div
          data-testid="image-error"
          className="mt-1.5 flex items-start gap-1.5 border-t border-brand-soft/60 pt-1.5 text-[12px] leading-snug text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
          <span>{m.error ?? "No se pudo leer la imagen"}</span>
        </div>
      )}
      {summary && (
        <div
          data-testid="image-summary"
          className="mt-1.5 flex items-start gap-1.5 border-t border-brand-soft/60 pt-1.5 text-[12px] leading-snug text-text-3"
        >
          <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-brand" strokeWidth={1.7} />
          <span className="min-w-0 break-words">
            {ownerImage && <span className="font-medium text-text-2">Lo que leyó: </span>}
            <span className="whitespace-pre-wrap">{shown}</span>
            {long && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="ml-1 font-medium text-brand-text underline underline-offset-2"
                data-testid="image-summary-toggle"
              >
                {expanded ? "Ver menos" : "Ver todo"}
              </button>
            )}
          </span>
        </div>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={ownerImage ? "Imagen para tu agente" : sentImage ? "Imagen enviada" : "Imagen del cliente"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={media.url} alt={summary || alt} className="max-h-[75vh] w-full object-contain" />
      </Dialog>
    </div>
  );
}

/**
 * Adjunto sin binario (026): todavía bajando, o no se pudo guardar. El
 * equipo igual ve qué mandó el cliente y por qué no está.
 */
function MissingAttachment({ message: m, noun }: { message: MessageDto; noun: string }) {
  const Icon = m.type === "video" ? Film : m.type === "document" ? FileText : Paperclip;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-1.5 text-text-3"
      data-testid="attachment-missing"
      data-status={m.mediaState ?? "none"}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
      {m.mediaState === "pending" ? `Descargando ${noun}…` : mediaLabel(m.type)}
      {m.mediaState !== "pending" && m.text ? ` — ${m.text}` : ""}
      {m.mediaState === "failed" && m.error ? (
        <span className="basis-full text-[12px] text-destructive">
          {m.error}
          {m.direction === "in" ? ": abrilo desde el celular." : ""}
        </span>
      ) : null}
    </span>
  );
}

/** Video (026): el que mandó el equipo o el que mandó el cliente. */
function VideoAttachment({ message: m }: { message: MessageDto }) {
  const media = m.media;
  if (!media) return <MissingAttachment message={m} noun="video" />;
  return (
    <div className="min-w-[200px]" data-testid="video-message">
      <video
        controls
        playsInline
        preload="metadata"
        src={media.url}
        data-testid="video-player"
        className="max-h-[320px] w-full max-w-[280px] rounded-md bg-black"
      />
      {m.text && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-[1.45]">
          <Linkified text={m.text} />
        </p>
      )}
    </div>
  );
}

/**
 * Documento (026): tarjeta con nombre, formato y tamaño; tocarla lo abre en
 * otra pestaña (PDF y texto se ven en el navegador; Office se descarga) y
 * el botón lo baja con su nombre original.
 */
function DocumentAttachment({ message: m }: { message: MessageDto }) {
  const media = m.media;
  if (!media) return <MissingAttachment message={m} noun="documento" />;
  const name = media.fileName ?? m.text ?? "Documento";
  // Un documento entrante sin epígrafe trae su nombre en `text` (020): no
  // se repite debajo de la tarjeta.
  const caption = m.text && m.text !== media.fileName ? m.text : null;
  const meta = [formatLabel(media.mimeType, media.fileName), formatFileSize(media.sizeBytes)]
    .filter(Boolean)
    .join(" · ");
  // 027: el PDF de un cliente lo lee la IA; el resumen ayuda al equipo y es
  // lo que ve el agente.
  const incoming = m.direction === "in";
  const summary = m.mediaSummary?.trim() ?? "";
  return (
    <div className="w-[240px] max-w-full md:w-[260px]" data-testid="document-message">
      <div className="flex items-center gap-1 rounded-md border border-brand-soft/60 bg-background/70 p-1.5">
        <a
          href={media.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="document-open"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-sm p-1 hover:bg-accent/60"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-tint text-brand-text">
            <FileText className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </span>
          <span className="min-w-0">
            <span
              className="line-clamp-2 break-words text-[13px] font-medium leading-snug text-foreground"
              title={name}
              data-testid="document-name"
            >
              {name}
            </span>
            <span className="block text-[11px] text-text-3" data-testid="document-meta">
              {meta}
            </span>
          </span>
        </a>
        <a
          href={`${media.url}?download=1`}
          download={name}
          aria-label={`Descargar ${name}`}
          title="Descargar"
          data-testid="document-download"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-accent hover:text-foreground"
        >
          <Download className="h-4 w-4" strokeWidth={1.7} />
        </a>
      </div>
      {caption && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-[1.45]">
          <Linkified text={caption} />
        </p>
      )}
      {incoming && m.mediaState === "pending" && (
        <div
          data-testid="document-reading"
          className="mt-1.5 flex items-center gap-1.5 border-t border-brand-soft/60 pt-1.5 text-[12px] text-text-3"
        >
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.7} />
          <span>Leyendo el documento…</span>
        </div>
      )}
      {incoming && m.mediaState === "failed" && m.error && (
        <div
          data-testid="document-read-error"
          className="mt-1.5 flex items-start gap-1.5 border-t border-brand-soft/60 pt-1.5 text-[12px] leading-snug text-text-3"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
          <span>{m.error}: el agente le va a preguntar de qué se trata.</span>
        </div>
      )}
      {summary && <SummaryLine text={summary} label="Lo que dice: " testId="document-summary" />}
    </div>
  );
}

/** Resumen escrito por la IA (027: PDF), plegable si es largo. */
function SummaryLine({ text, label, testId }: { text: string; label: string; testId: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 280;
  const shown = long && !expanded ? `${text.slice(0, 280).trimEnd()}…` : text;
  return (
    <div
      data-testid={testId}
      className="mt-1.5 flex items-start gap-1.5 border-t border-brand-soft/60 pt-1.5 text-[12px] leading-snug text-text-3"
    >
      <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-brand" strokeWidth={1.7} />
      <span className="min-w-0 break-words">
        <span className="font-medium text-text-2">{label}</span>
        <span className="whitespace-pre-wrap">{shown}</span>
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-1 font-medium text-brand-text underline underline-offset-2"
          >
            {expanded ? "Ver menos" : "Ver todo"}
          </button>
        )}
      </span>
    </div>
  );
}

/** «Reintentar» de un adjunto fallido (026): reenvía el binario guardado. */
function RetryButton({
  messageId,
  onRetry,
}: {
  messageId: string;
  onRetry: (messageId: string) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        data-testid="message-retry"
        onClick={async (e) => {
          e.stopPropagation();
          setBusy(true);
          setError(null);
          const err = await onRetry(messageId);
          setBusy(false);
          if (err) setError(err);
        }}
        className="inline-flex items-center gap-1 rounded-full border border-destructive/30 px-2.5 py-0.5 text-[11.5px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.8} />
        ) : (
          <RotateCw className="h-3 w-3" strokeWidth={1.8} />
        )}
        {busy ? "Reintentando…" : "Reintentar"}
      </button>
      {error && (
        <span className="text-[11px] text-destructive" data-testid="message-retry-error">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * 030: nota de un comentario de Instagram que disparó una regla: qué comentó
 * y en qué publicación (el DM automático viene debajo).
 */
function CommentNote({ message: m }: { message: MessageDto }) {
  const c = m.details?.comment;
  return (
    <div className="min-w-[200px]" data-testid="message-comment">
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-[#d62976]">
        <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
        {c?.live ? "Comentó en tu vivo" : "Comentó en tu publicación"}
      </p>
      {m.text && <p className="mt-1 whitespace-pre-wrap break-words">«{m.text}»</p>}
      {(m.mediaSummary || c?.permalink) && (
        <p className="mt-1 text-[11.5px] text-text-3">
          {m.mediaSummary ? `«${m.mediaSummary}»` : null}
          {c?.permalink && (
            <a href={c.permalink} target="_blank" rel="noreferrer" className="ml-1 text-brand-text underline underline-offset-2">
              Ver publicación
            </a>
          )}
        </p>
      )}
    </div>
  );
}

/** 030: respuesta o mención de una historia, con la historia bajada. */
function StoryAttachment({ message: m, kind }: { message: MessageDto; kind: "whatsapp" | "trainer" | "instagram" }) {
  const reply = m.details?.story?.kind === "reply" || (!m.details?.story && !!m.text);
  const isVideo = m.media?.mimeType.startsWith("video/");
  return (
    <div className="min-w-[180px]" data-testid="message-story">
      <p className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-[#d62976]">
        <CircleDashed className="h-3.5 w-3.5" strokeWidth={1.8} />
        {reply ? "Respondió a tu historia" : "Te mencionó en su historia"}
      </p>
      {m.media ? (
        isVideo ? (
          <VideoAttachment message={m} />
        ) : (
          <ImageAttachment message={m} kind={kind} />
        )
      ) : (
        <>
          <span className="text-[12px] text-text-3">
            {m.mediaState === "pending" ? "Descargando la historia…" : "La historia ya no está disponible"}
          </span>
          {m.text && (
            <p className="mt-1 whitespace-pre-wrap break-words">
              <Linkified text={m.text} />
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 030: lo que acompaña a un mensaje de Instagram: botones, tarjetas y
 * respuestas rápidas (lo que vio la persona), el origen automático de un DM
 * (regla de comentarios), los botones de una plantilla de otra app y el aviso
 * de standby.
 */
function InstagramExtras({ message: m }: { message: MessageDto }) {
  const d = m.details;
  if (!d) return null;
  const chips: { key: string; label: string; href?: string }[] = [
    ...(d.buttons ?? []).map((b, i) => ({ key: `b${i}`, label: b.title, href: b.url })),
    ...(d.quickReplies ?? []).map((q, i) => ({
      key: `q${i}`,
      label: q.kind === "text" ? q.title : q.kind === "email" ? "Mi email" : "Mi teléfono",
    })),
    ...(d.template?.buttons ?? []).map((t, i) => ({ key: `t${i}`, label: t })),
  ];
  const automatic = m.direction === "out" && m.type !== "comment" && d.comment;
  if (chips.length === 0 && !d.cards?.length && !automatic && !d.standby) return null;
  return (
    <div className="clear-both" data-testid="message-ig-extras">
      {d.cards && d.cards.length > 0 && (
        <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
          {d.cards.map((c, i) => (
            <a
              key={i}
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className="w-40 shrink-0 overflow-hidden rounded-md border border-brand-soft/60 bg-background text-left"
            >
              {c.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- imagen del negocio
                <img src={c.imageUrl} alt="" className="h-20 w-full object-cover" loading="lazy" />
              )}
              <span className="block px-2 pt-1.5 text-[12px] font-medium leading-tight">{c.title}</span>
              {c.subtitle && <span className="block px-2 text-[11px] leading-tight text-text-3">{c.subtitle}</span>}
              <span className="block px-2 pb-1.5 pt-1 text-[11px] font-medium text-brand-text">{c.buttonTitle || "Ver"}</span>
            </a>
          ))}
        </div>
      )}
      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {chips.map((c) =>
            c.href ? (
              <a key={c.key} href={c.href} target="_blank" rel="noreferrer" className="rounded-full border border-brand-soft bg-background px-2.5 py-0.5 text-[11.5px] text-brand-text">
                {c.label}
              </a>
            ) : (
              <span key={c.key} className="rounded-full border border-brand-soft bg-background px-2.5 py-0.5 text-[11.5px] text-text-2">
                {c.label}
              </span>
            )
          )}
        </div>
      )}
      {automatic && (
        <span data-testid="message-comment-auto" className="mt-1.5 block border-t border-brand-soft/60 pt-1 text-[11px] leading-snug text-text-3">
          Respuesta automática a un comentario{d.comment?.ruleName ? ` · ${d.comment.ruleName}` : ""}
        </span>
      )}
      {d.standby && (
        <span data-testid="message-standby" className="mt-1.5 block border-t pt-1 text-[11px] leading-snug text-[#8a6d3b]">
          Otra app maneja esta conversación en Instagram: el agente no responde
        </span>
      )}
    </div>
  );
}

function Bubble({
  message: m,
  kind,
  grouped,
  onLongPress,
  onRetry,
}: {
  message: MessageDto;
  kind: "whatsapp" | "trainer" | "instagram";
  grouped: boolean;
  onLongPress: () => void;
  onRetry?: (messageId: string) => Promise<string | null>;
}) {
  const { handlers } = useLongPress(onLongPress);
  const out = m.direction === "out";
  // Canal real (WhatsApp o Instagram, 023): ticks, origen y motivo de fallo.
  const wa = kind !== "trainer";
  const ig = kind === "instagram";
  // 023: la reacción del cliente es una nota chica, no una burbuja.
  if (m.type === "reaction") {
    return (
      <div className={cn("flex justify-start", grouped ? "mt-[3px]" : "mt-2.5")}>
        <span
          data-testid="message-reaction"
          className="rounded-full bg-background/70 px-2.5 py-0.5 text-[11.5px] text-text-3 shadow-sm"
        >
          Reaccionó {m.text ?? "❤️"} a un mensaje · {bubbleTime(m.createdAt)}
        </span>
      </div>
    );
  }
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
        {m.type === "deleted" ? (
          <span data-testid="message-deleted" className="italic text-text-3">
            Mensaje eliminado por el cliente
          </span>
        ) : m.type === "text" || m.type === "template" ? (
          <span className="whitespace-pre-wrap break-words">
            <Linkified text={m.text} />
          </span>
        ) : m.type === "audio" ? (
          <AudioNote message={m} plain={out && wa} />
        ) : m.type === "image" ? (
          <ImageAttachment message={m} kind={kind} />
        ) : m.type === "video" ? (
          <VideoAttachment message={m} />
        ) : m.type === "document" ? (
          <DocumentAttachment message={m} />
        ) : m.type === "comment" ? (
          <CommentNote message={m} />
        ) : m.type === "story" ? (
          <StoryAttachment message={m} kind={kind} />
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
        <InstagramExtras message={m} />
        {out && wa && m.source === "phone" && (
          <span
            data-testid="message-from-phone"
            className="mt-1.5 block clear-both border-t border-brand-soft/60 pt-1 text-[11px] leading-snug text-text-3"
            title={
              ig
                ? "Lo respondieron desde la app de Instagram"
                : "Lo mandaste desde la app de WhatsApp del celular"
            }
          >
            {ig ? "Desde Instagram" : "Desde el celular"}
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
            {onRetry &&
              m.source === "cloud" &&
              (OUTBOUND_KINDS as readonly string[]).includes(m.type) &&
              m.media && <RetryButton messageId={m.id} onRetry={onRetry} />}
          </span>
        )}
      </div>
    </div>
  );
}
