"use client";

import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock3,
  Paperclip,
  Sparkles,
} from "lucide-react";
import type { MessageDto } from "@/lib/types";
import { friendlyDeliveryError } from "@/lib/meta-errors";
import { cn } from "@/lib/utils";
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

export function MessageThread({ messages }: { messages: MessageDto[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div
      ref={scrollRef}
      className="flex flex-1 flex-col gap-[3px] overflow-y-auto bg-chat px-[6%] py-5"
    >
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay =
          !prev ||
          new Date(prev.createdAt).toDateString() !==
            new Date(m.createdAt).toDateString();
        const grouped =
          !newDay && prev !== undefined && prev.direction === m.direction;
        const out = m.direction === "out";

        return (
          <div key={m.id}>
            {newDay && (
              <div className="my-3 flex justify-center">
                <span className="rounded-full border bg-background px-3 py-1 text-[11.5px] font-semibold text-text-2 shadow-sm">
                  {dayLabel(m.createdAt)}
                </span>
              </div>
            )}
            <div
              className={cn(
                "flex",
                out ? "justify-end" : "justify-start",
                grouped ? "mt-[3px]" : "mt-2.5"
              )}
            >
              <div
                className={cn(
                  "max-w-[64%] rounded-lg px-3 pb-1.5 pt-2 text-sm leading-[1.45] shadow-sm",
                  out
                    ? "border border-brand-soft bg-bubble-out text-bubble-out-text"
                    : "bg-background",
                  !grouped && (out ? "rounded-tr-[5px]" : "rounded-tl-[5px]")
                )}
              >
                {m.type === "text" || m.type === "template" ? (
                  <span className="whitespace-pre-wrap break-words">
                    {m.text}
                  </span>
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
                      className="inline-flex items-center gap-0.5 text-[10px] font-medium text-brand"
                      title="Respuesta generada por IA"
                    >
                      <Sparkles className="h-3 w-3" strokeWidth={1.7} /> IA
                    </span>
                  )}
                  <span className="text-[10.5px] text-text-4">
                    {bubbleTime(m.createdAt)}
                  </span>
                  {out && <StatusTicks status={m.status} error={m.error} />}
                </span>
                {out && m.status === "failed" && (
                  <span
                    data-testid="message-fail-reason"
                    className="mt-1.5 block clear-both border-t border-destructive/20 pt-1 text-[11px] leading-snug text-destructive"
                  >
                    No entregado:{" "}
                    {friendlyDeliveryError(m.error) ??
                      "el canal no informó el motivo"}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
