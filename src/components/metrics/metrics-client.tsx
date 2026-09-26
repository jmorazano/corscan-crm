"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Bot, Inbox, Timer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useQueryFilters } from "@/components/use-query-filters";
import { cn } from "@/lib/utils";
import {
  DEFAULT_METRICS_TIMEZONE,
  METRICS_RANGES,
  RANGE_SPECS,
  deltaRatio,
  formatCount,
  formatDelta,
  formatDuration,
  isMetricsRange,
  periodLabel,
  type MetricsOverview,
  type MetricsRange,
} from "@/lib/metrics";
import { CHANNEL_SERIES, StackedBars } from "./stacked-bars";

/**
 * Métricas del propietario (024): un selector de período arriba de todo
 * recorta las tres tarjetas y el histograma (los números siempre
 * coinciden). El período vive en la URL (`?range=`); al cambiarlo, lo
 * anterior queda atenuado hasta que llega lo nuevo, sin saltos de diseño.
 */

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_METRICS_TIMEZONE;
  } catch {
    return DEFAULT_METRICS_TIMEZONE;
  }
}

export function MetricsClient() {
  const { params, set } = useQueryFilters();
  const rawRange = params.get("range") ?? "day";
  const range: MetricsRange = isMetricsRange(rawRange) ? rawRange : "day";

  const [data, setData] = useState<MetricsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    const qs = new URLSearchParams({ range, tz: browserTimeZone() });
    fetch(`/api/metrics?${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<MetricsOverview>) : Promise.reject(r.status)))
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        console.warn("[métricas] no se pudieron cargar:", err);
        setError(true);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [range, reloadTick]);

  const spec = RANGE_SPECS[range];
  // Lo que se ve corresponde a los datos cargados (que pueden ser del
  // período anterior mientras llega el nuevo).
  const shown = data;
  const shownSpec = shown ? RANGE_SPECS[shown.range] : spec;
  const period = useMemo(
    () =>
      shown
        ? periodLabel(
            shown.series.map((p) => p.key),
            shown.unit,
            new Date(),
            shown.timeZone
          )
        : "",
    [shown]
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" data-testid="metrics">
      {/* Filtro único, arriba de todo lo que recorta. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div
          role="radiogroup"
          aria-label="Período"
          className="inline-flex rounded-md border bg-subtle p-0.5"
        >
          {METRICS_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={r === range}
              data-testid={`metrics-range-${r}`}
              onClick={() => set({ range: r === "day" ? null : r })}
              className={cn(
                "rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors",
                r === range
                  ? "bg-background text-foreground shadow-sm"
                  : "text-text-2 hover:text-foreground"
              )}
            >
              {RANGE_SPECS[r].label}
            </button>
          ))}
        </div>
        <p className="text-sm text-text-3" data-testid="metrics-period">
          {shownSpec.period}
          {period && <span className="hidden sm:inline"> · {period}</span>}
        </p>
      </div>

      {error && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <span>No se pudieron cargar las métricas.</span>
          <button
            type="button"
            className="font-medium text-brand-text underline underline-offset-2"
            onClick={() => setReloadTick((t) => t + 1)}
          >
            Reintentar
          </button>
        </div>
      )}

      {!shown && !error ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : shown ? (
        <div
          className={cn("flex flex-col gap-4 transition-opacity", loading && "opacity-60")}
          aria-busy={loading}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <ReceivedCard data={shown} previousLabel={shownSpec.previous} />
            <AgentSentCard data={shown} previousLabel={shownSpec.previous} />
            <ResponseTimeCard data={shown} previousLabel={shownSpec.previous} />
          </div>
          <Card className="p-4 md:p-5" data-testid="metrics-histogram">
            <StackedBars series={shown.series} unit={shown.unit} />
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StatCard({
  icon: Icon,
  label,
  value,
  delta,
  children,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  delta: React.ReactNode;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <Card className="flex flex-col p-4" data-testid={testId}>
      <div className="flex items-center gap-2 text-[13px] font-medium text-text-2">
        <Icon className="h-4 w-4 text-text-3" strokeWidth={1.7} aria-hidden />
        {label}
      </div>
      <div
        className="mt-2 text-[30px] font-semibold leading-none tracking-tight"
        data-testid={`${testId}-value`}
      >
        {value}
      </div>
      <div className="mt-2 min-h-[18px] text-xs">{delta}</div>
      <div className="mt-3 flex-1 border-t pt-3 text-xs text-text-2">{children}</div>
    </Card>
  );
}

/**
 * Cambio contra el período anterior. `goodWhenUp` decide el color de la
 * flecha (el texto nunca lleva el color): en los conteos no hay «bueno» ni
 * «malo», así que queda neutra; en el tiempo de respuesta, bajar es bueno.
 */
function Delta({
  current,
  previous,
  previousLabel,
  goodWhenUp,
}: {
  current: number | null;
  previous: number | null;
  previousLabel: string;
  goodWhenUp: boolean | null;
}) {
  const ratio = deltaRatio(current, previous);
  if (ratio === null) {
    return <span className="text-text-3">Sin datos de {previousLabel}</span>;
  }
  const up = ratio > 0;
  const flat = Math.round(ratio * 100) === 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  const tone =
    flat || goodWhenUp === null
      ? "text-text-3"
      : up === goodWhenUp
        ? "text-success"
        : "text-destructive";
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-1 text-text-2"
      data-testid="metrics-delta"
    >
      <span className="inline-flex items-center gap-0.5 whitespace-nowrap font-medium">
        {!flat && <Arrow className={cn("h-3.5 w-3.5", tone)} strokeWidth={2} aria-hidden />}
        {formatDelta(ratio)}
      </span>
      <span className="text-text-3">vs. {previousLabel}</span>
    </span>
  );
}

function ChannelDot({ channel }: { channel: "whatsapp" | "instagram" }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
      style={{ background: CHANNEL_SERIES[channel].color }}
    />
  );
}

function ReceivedCard({ data, previousLabel }: { data: MetricsOverview; previousLabel: string }) {
  const r = data.received;
  return (
    <StatCard
      icon={Inbox}
      label="Mensajes recibidos"
      value={formatCount(r.total)}
      testId="metrics-received"
      delta={
        <Delta current={r.total} previous={r.previous} previousLabel={previousLabel} goodWhenUp={null} />
      }
    >
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(["whatsapp", "instagram"] as const).map((ch) => (
          <span key={ch} className="inline-flex items-center gap-1.5" data-testid={`metrics-received-${ch}`}>
            <ChannelDot channel={ch} />
            {CHANNEL_SERIES[ch].label}
            <span className="font-semibold text-foreground">{formatCount(r[ch])}</span>
          </span>
        ))}
      </div>
    </StatCard>
  );
}

function AgentSentCard({ data, previousLabel }: { data: MetricsOverview; previousLabel: string }) {
  const a = data.agentSent;
  const share = a.allSent > 0 ? Math.round((a.total / a.allSent) * 100) : null;
  return (
    <StatCard
      icon={Bot}
      label="Enviados por el agente"
      value={formatCount(a.total)}
      testId="metrics-agent"
      delta={
        <Delta current={a.total} previous={a.previous} previousLabel={previousLabel} goodWhenUp={null} />
      }
    >
      {share === null ? (
        <span className="text-text-3">La empresa no envió mensajes en este período.</span>
      ) : (
        <span data-testid="metrics-agent-share">
          <span className="font-semibold text-foreground">{share} %</span> de todo lo que envió la
          empresa ({formatCount(a.allSent)})
        </span>
      )}
    </StatCard>
  );
}

function ResponseTimeCard({ data, previousLabel }: { data: MetricsOverview; previousLabel: string }) {
  const t = data.responseTime;
  const delaySeconds = Math.round(t.replyDelayMs / 1000);
  return (
    <StatCard
      icon={Timer}
      label="Tiempo de respuesta"
      value={formatDuration(t.medianMs)}
      testId="metrics-response"
      delta={
        <Delta
          current={t.medianMs}
          previous={t.previousMedianMs}
          previousLabel={previousLabel}
          goodWhenUp={false}
        />
      }
    >
      {t.count === 0 ? (
        <span className="text-text-3">Sin respuestas del agente en este período.</span>
      ) : (
        <div className="flex flex-col gap-1">
          <span data-testid="metrics-response-average">
            Promedio <span className="font-semibold text-foreground">{formatDuration(t.avgMs)}</span>
            {" · "}
            {formatCount(t.count)} {t.count === 1 ? "respuesta" : "respuestas"}
          </span>
          <span className="text-text-3">
            Mediana de las respuestas del agente (la mitad fue más rápida),
            desde el primer mensaje del cliente sin responder
            {delaySeconds > 0 ? `; incluye la espera de ${delaySeconds} s antes de responder` : ""}.
          </span>
        </div>
      )}
    </StatCard>
  );
}
