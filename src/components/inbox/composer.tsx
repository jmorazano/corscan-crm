"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Clock3, Mic, Paperclip, Send, X, Zap } from "lucide-react";
import type { ConversationDto, TemplateDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { filterQuickReplies, quickReplyQuery } from "@/lib/gestures";
import { composerMode } from "@/lib/trainer";
import { fileNameFor, formatElapsed } from "@/lib/audio-record";
import { VOICE_NOTE_MAX_BYTES, VOICE_NOTE_MAX_MS } from "@/lib/voice-note";
import { useIsMobile } from "@/components/use-media";
import { formatRemaining } from "./helpers";
import { TemplateSender } from "./template-sender";
import { QuickReplies } from "./quick-replies";
import { useVoiceRecorder } from "./use-voice-recorder";

/** Envío de una nota de voz (015): devuelve un mensaje de error o null. */
export type SendAudio = (
  file: File,
  meta: { durationMs: number | null }
) => Promise<string | null>;

export function Composer({
  conversation,
  onSend,
  onSendAudio,
  onSent,
}: {
  conversation: ConversationDto;
  onSend: (text: string) => Promise<string | null>;
  /** 015: solo la conversación con el agente acepta notas de voz. */
  onSendAudio?: SendAudio;
  onSent: () => void;
}) {
  const isMobile = useIsMobile();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [dragging, setDragging] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 015: grabador (tap para grabar / tap para enviar) y adjunto de archivo.
  const recorder = useVoiceRecorder({
    maxMs: VOICE_NOTE_MAX_MS,
    onBlob: async (blob, meta) => {
      if (!onSendAudio) return "Esta conversación no acepta notas de voz";
      const file = new File([blob], fileNameFor(meta.mimeType), { type: meta.mimeType });
      return sendAudioFile(file, meta.durationMs);
    },
  });

  function localAudioError(file: File): string | null {
    if (!onSendAudio) return "Esta conversación no acepta notas de voz";
    if (file.size === 0) return "El archivo está vacío";
    if (file.size > VOICE_NOTE_MAX_BYTES) {
      return "La nota de voz supera el máximo de 8 MB (unos 3 minutos)";
    }
    if (file.type && !file.type.startsWith("audio/") && !file.type.startsWith("video/mp4")) {
      return "El archivo no es un audio válido (.m4a, .ogg, .wav, .mp3)";
    }
    return null;
  }

  async function sendAudioFile(file: File, durationMs: number | null): Promise<string | null> {
    // Rechazo local ANTES de subir (tamaño/tipo); el servidor revalida.
    const local = localAudioError(file);
    if (local) {
      setError(local);
      return local;
    }
    setError(null);
    const err = await onSendAudio!(file, { durationMs });
    if (err) setError(err);
    return err;
  }

  function onPickFile(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    void sendAudioFile(file, null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onDrop(e: DragEvent) {
    if (!onSendAudio) return;
    e.preventDefault();
    setDragging(false);
    onPickFile(e.dataTransfer.files);
  }

  // Respuestas rápidas (012, FR-008): `/` abre el selector; el rayo también.
  const [qrForce, setQrForce] = useState(false);
  const [qrDismissedFor, setQrDismissedFor] = useState<string | null>(null);
  const [qrIndex, setQrIndex] = useState(0);
  const qrQuery = quickReplyQuery(text);
  const qrOpen =
    conversation.kind !== "trainer" &&
    templates.length > 0 &&
    (qrForce || (qrQuery !== null && qrDismissedFor !== text));
  const qrItems = useMemo(
    () => filterQuickReplies(templates, qrForce ? "" : (qrQuery ?? "")),
    [templates, qrForce, qrQuery]
  );
  useEffect(() => {
    setQrIndex(0);
  }, [qrQuery, qrForce]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: TemplateDto[] }) => {
        if (!cancelled)
          setTemplates((d.templates ?? []).filter((t) => t.status === "approved"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function autogrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  function insertTemplate(t: TemplateDto) {
    const firstName = conversation.contact.name.split(" ")[0] ?? "";
    setText(t.body.replace(/\{\{\s*1\s*\}\}/g, firstName));
    setQrForce(false);
    setQrDismissedFor(null);
    taRef.current?.focus();
    setTimeout(autogrow, 0);
  }

  async function submit() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError(null);
    const err = await onSend(value);
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setText("");
    if (taRef.current) taRef.current.style.height = "auto";
  }

  const mode = composerMode(conversation);
  const isTrainer = mode === "trainer";

  if (mode === "template") {
    return (
      <div className="safe-bottom border-t bg-background px-3 py-3 md:px-[18px] md:py-3.5">
        <div className="mb-3 flex items-start gap-2 rounded-md border border-[#ece2cf] bg-[#faf7f0] p-3 text-sm text-[#8a6d3b]">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <div>
            <p className="font-medium">La ventana de 24 horas está cerrada.</p>
            <p className="opacity-80">
              WhatsApp solo permite texto libre dentro de las 24 horas
              siguientes al último mensaje del cliente. Para retomar la
              conversación, envía una plantilla aprobada.
            </p>
          </div>
        </div>
        <TemplateSender conversationId={conversation.id} onSent={onSent} />
      </div>
    );
  }

  const canRecord = isTrainer && Boolean(onSendAudio);
  const recording = recorder.state === "recording" || recorder.state === "requesting";
  const uploading = recorder.state === "uploading";
  const showMic = canRecord && recorder.supported && text.trim().length === 0;

  return (
    <div
      className={cn(
        "safe-bottom border-t bg-background px-2 pb-2 pt-2 md:px-[18px] md:pb-3.5 md:pt-3",
        dragging && "bg-brand-tint"
      )}
      onDragOver={(e) => {
        if (!canRecord) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {canRecord && (
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.m4a,.mp3,.ogg,.aac,.flac"
          hidden
          data-testid="audio-file"
          onChange={(e) => onPickFile(e.target.files)}
        />
      )}
      {recording || uploading ? (
        <div className="flex items-center gap-2" data-testid="recording-bar">
          <button
            type="button"
            aria-label="Cancelar grabación"
            data-testid="record-cancel"
            disabled={uploading}
            onClick={recorder.cancel}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-accent disabled:opacity-40 md:h-[34px] md:w-[34px]"
          >
            <X className="h-5 w-5 md:h-4 md:w-4" strokeWidth={1.8} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[22px] border bg-background px-3 py-2.5 text-sm md:rounded-md">
            {uploading ? (
              <span className="text-text-2">Enviando nota de voz…</span>
            ) : (
              <>
                <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden />
                <span className="tabular-nums text-text-2" data-testid="record-elapsed">
                  {formatElapsed(recorder.elapsedMs)} / {formatElapsed(VOICE_NOTE_MAX_MS)}
                </span>
                <span className="truncate text-xs text-text-3">
                  {recorder.state === "requesting" ? "Pidiendo permiso…" : "Grabando"}
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            aria-label="Detener y enviar"
            data-testid="record-stop"
            disabled={uploading || recorder.state !== "recording"}
            onClick={() => void recorder.stop()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-opacity hover:bg-brand-hover disabled:opacity-40 md:h-[34px] md:w-[34px] md:rounded-[9px]"
          >
            <Send className="h-5 w-5 md:h-4 md:w-4" strokeWidth={1.7} />
          </button>
        </div>
      ) : null}
      {!(recording || uploading) && qrOpen && (
        <QuickReplies
          items={qrItems}
          query={qrForce ? "" : (qrQuery ?? "")}
          activeIndex={qrIndex}
          onHover={setQrIndex}
          onPick={insertTemplate}
        />
      )}
      {templates.length > 0 && !qrOpen && !isTrainer && (
        <div className="mb-2.5 hidden flex-wrap gap-1.5 md:flex">
          {templates.slice(0, 4).map((t) => (
            <button
              key={t.id}
              className="rounded-full border bg-secondary px-3 py-1 text-xs font-medium text-text-2 transition-colors hover:border-brand-soft hover:bg-brand-tint hover:text-brand-text"
              onClick={() => insertTemplate(t)}
              title={t.body}
            >
              {t.name.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}
      <div className={cn("flex items-end gap-1.5 md:gap-2", (recording || uploading) && "hidden")}>
        {canRecord && (
          <button
            type="button"
            aria-label="Adjuntar audio"
            title="Adjuntar un archivo de audio"
            data-testid="audio-attach"
            onClick={() => fileRef.current?.click()}
            className="hidden h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-accent md:flex"
          >
            <Paperclip className="h-4 w-4" strokeWidth={1.7} />
          </button>
        )}
        {!isTrainer && (
        <button
          type="button"
          aria-label="Respuestas rápidas"
          aria-expanded={qrOpen}
          title="Respuestas rápidas (escribe /)"
          data-testid="quick-replies-toggle"
          disabled={templates.length === 0}
          onClick={() => {
            setQrDismissedFor(null);
            setQrForce((v) => !v);
          }}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent disabled:opacity-30 md:h-[34px] md:w-[34px]",
            qrOpen ? "text-brand" : "text-text-3"
          )}
        >
          <Zap className="h-5 w-5 md:h-4 md:w-4" strokeWidth={1.7} />
        </button>
        )}
        <div className="flex min-w-0 flex-1 items-end rounded-[22px] border bg-background px-3 py-1.5 transition-shadow focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft md:rounded-md md:py-2">
          <textarea
            ref={taRef}
            placeholder={
              isTrainer
                ? `Decile a ${conversation.contact.name} qué tiene que saber o cómo responder…`
                : "Escribe una respuesta…"
            }
            data-testid="composer-input"
            value={text}
            rows={1}
            enterKeyHint={isMobile ? "enter" : "send"}
            onChange={(e) => {
              setText(e.target.value);
              autogrow();
            }}
            onKeyDown={(e) => {
              if (qrOpen) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setQrIndex((i) => Math.min(qrItems.length - 1, i + 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setQrIndex((i) => Math.max(0, i - 1));
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setQrForce(false);
                  setQrDismissedFor(text);
                  return;
                }
                if ((e.key === "Enter" || e.key === "Tab") && !isMobile) {
                  const pick = qrItems[qrIndex];
                  if (pick) {
                    e.preventDefault();
                    insertTemplate(pick);
                    return;
                  }
                }
              }
              // Escritorio: Enter envía, Shift+Enter salta de línea. Móvil:
              // Enter salta de línea y se envía con el botón (como WhatsApp).
              if (e.key === "Enter" && !e.shiftKey && !isMobile) {
                e.preventDefault();
                void submit();
              }
            }}
            className="max-h-[120px] w-full resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-text-3 md:text-sm"
          />
        </div>
        {showMic ? (
          <button
            type="button"
            onClick={() => {
              recorder.clearError();
              void recorder.start();
            }}
            aria-label="Grabar nota de voz"
            title="Grabar una nota de voz"
            data-testid="composer-mic"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-opacity hover:bg-brand-hover md:h-[34px] md:w-[34px] md:rounded-[9px]"
          >
            <Mic className="h-5 w-5 md:h-4 md:w-4" strokeWidth={1.7} />
          </button>
        ) : (
          <button
            onClick={() => void submit()}
            disabled={sending || text.trim().length === 0}
            aria-label="Enviar"
            data-testid="composer-send"
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-opacity hover:bg-brand-hover md:h-[34px] md:w-[34px] md:rounded-[9px]",
              (sending || !text.trim()) && "opacity-40"
            )}
          >
            <Send className="h-5 w-5 md:h-4 md:w-4" strokeWidth={1.7} />
          </button>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between px-1 md:mt-1.5 md:px-0">
        {error || recorder.error ? (
          <p className="text-xs text-destructive" data-testid="composer-error">
            {error ?? recorder.error}
          </p>
        ) : (
          <span />
        )}
        <p className="text-[11px] text-text-3">
          {isTrainer
            ? "Los cambios se aplican al instante y se pueden deshacer"
            : `Ventana abierta · quedan ${formatRemaining(conversation.windowRemainingMs)}`}
        </p>
      </div>
    </div>
  );
}
