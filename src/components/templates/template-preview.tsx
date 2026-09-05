"use client";

import { useEffect, useState } from "react";
import { CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  parseInlineFormat,
  splitBodyVariables,
  TEMPLATE_VARIABLES,
} from "@/lib/template-body";

type Props = {
  body: string;
  /** Valor de ejemplo con el que se muestra {{1}} (vacío = chip del token). */
  sampleValue?: string;
  /** Sin marco de teléfono: solo la burbuja (para listas). */
  compact?: boolean;
  className?: string;
};

/**
 * Preview del cuerpo como lo vería el contacto en WhatsApp: burbuja saliente
 * sobre el fondo del chat, variables resaltadas y formato inline
 * (*negrita*, _cursiva_, ~tachado~, ```mono```) aplicado.
 */
export function TemplatePreview({ body, sampleValue, compact, className }: Props) {
  const time = useClockLabel();
  const empty = body.trim().length === 0;

  const bubble = (
    <div
      data-testid="template-preview-bubble"
      className={cn(
        "ml-auto max-w-[88%] rounded-lg rounded-tr-[5px] border border-brand-soft bg-bubble-out px-3 pb-1.5 pt-2 text-sm leading-[1.45] text-bubble-out-text shadow-sm",
        compact && "max-w-full"
      )}
    >
      {empty ? (
        <span className="italic text-text-4">
          Escribí el cuerpo para ver cómo se lee…
        </span>
      ) : (
        <span className="whitespace-pre-wrap break-words">
          <BodyRich body={body} sampleValue={sampleValue} />
        </span>
      )}
      <span className="float-right ml-2 mt-1 flex items-center gap-1">
        <span className="text-[10.5px] text-text-4">{time}</span>
        <CheckCheck className="h-3.5 w-3.5 text-brand" strokeWidth={1.7} />
      </span>
    </div>
  );

  if (compact) {
    return (
      <div className={cn("rounded-md bg-chat px-3 py-2.5", className)}>{bubble}</div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border-strong bg-background shadow-sm",
        className
      )}
    >
      <div className="flex items-center gap-2.5 border-b bg-subtle px-3 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white">
          TU
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold">Tu empresa</p>
          <p className="text-[11px] text-text-3">Cuenta de empresa</p>
        </div>
      </div>
      <div className="min-h-[150px] bg-chat px-3 py-4">
        <div className="mb-3 flex justify-center">
          <span className="rounded-full border bg-background px-3 py-1 text-[11px] font-semibold text-text-2 shadow-sm">
            Hoy
          </span>
        </div>
        {bubble}
      </div>
    </div>
  );
}

/** Hora local del navegador, resuelta tras montar (evita mismatch SSR/CSR). */
function useClockLabel(): string {
  const [time, setTime] = useState("");
  useEffect(() => {
    const now = new Date();
    setTime(
      `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    );
  }, []);
  return time;
}

function BodyRich({ body, sampleValue }: { body: string; sampleValue?: string }) {
  const segments = splitBodyVariables(body);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "variable") {
          const known = TEMPLATE_VARIABLES.find((v) => v.key === seg.key);
          const value = sampleValue?.trim() || known?.sample || seg.raw;
          return (
            <span
              key={i}
              title={known ? `${seg.raw} · ${known.label}` : `${seg.raw} · variable no admitida`}
              className={cn(
                "rounded-[4px] px-1 py-px font-medium",
                known
                  ? "bg-brand/15 text-brand-text underline decoration-brand/50 decoration-dotted underline-offset-2"
                  : "bg-destructive/15 text-destructive line-through"
              )}
            >
              {value}
            </span>
          );
        }
        return <InlineText key={i} text={seg.text} />;
      })}
    </>
  );
}

function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInlineFormat(text).map((span, i) => {
        if (span.mono) {
          return (
            <code key={i} className="rounded bg-black/5 px-1 font-mono text-[12.5px]">
              {span.text}
            </code>
          );
        }
        return (
          <span
            key={i}
            className={cn(
              span.bold && "font-semibold",
              span.italic && "italic",
              span.strike && "line-through"
            )}
          >
            {span.text}
          </span>
        );
      })}
    </>
  );
}
