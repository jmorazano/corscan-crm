"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  bucketAxisLabel,
  bucketLongLabel,
  formatCount,
  niceTicks,
  type BucketUnit,
  type SeriesPoint,
} from "@/lib/metrics";

/**
 * Histograma apilado de mensajes recibidos por canal (024). SVG propio (sin
 * librería de gráficos): WhatsApp en la base, Instagram arriba, separados
 * por 2 px de superficie; barras de ≤ 24 px con el extremo de datos
 * redondeado (4 px) y la base recta. Los colores son los del canal (los
 * mismos del ícono de la Bandeja), validados para daltonismo; como el verde
 * queda por debajo de 3:1 sobre blanco, la vista de tabla acompaña siempre.
 *
 * Interacción: cada barra es su propio blanco (toda la franja, no solo el
 * trazo); el tooltip lista ambos canales y el total. Con el foco en el
 * gráfico, ←/→ recorren las barras (mismo tooltip que con el puntero).
 */

export const CHANNEL_SERIES = {
  whatsapp: { label: "WhatsApp", color: "#25D366" },
  instagram: { label: "Instagram", color: "#d62976" },
} as const;

const STACK: ReadonlyArray<keyof typeof CHANNEL_SERIES> = ["whatsapp", "instagram"];

const HEIGHT = 240;
const PAD = { top: 12, right: 8, bottom: 26, left: 40 };
const BAR_MAX = 24;
const GAP = 2;
const RADIUS = 4;
const LABEL_MIN_SPACING = 40;

const UNIT_TITLE: Record<BucketUnit, string> = {
  day: "por día",
  week: "por semana",
  month: "por mes",
};

/** Rectángulo con solo las esquinas superiores redondeadas (base recta). */
function topRoundedBar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  return [
    `M${x},${y + h}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${y + h}`,
    "Z",
  ].join(" ");
}

/**
 * Ancho real del contenedor (las barras se dibujan a píxel, no con un
 * viewBox estirado). Ref por callback: el contenedor se desmonta al pasar a
 * la vista de tabla y vuelve a montarse al volver.
 */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

export function StackedBars({ series, unit }: { series: SeriesPoint[]; unit: BucketUnit }) {
  const [wrapRef, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  // Cambio de período → otra cantidad de barras: el índice activo ya no vale.
  useEffect(() => setActive(null), [series.length, unit]);

  const n = series.length;
  const totals = series.map((p) => p.whatsapp + p.instagram);
  const max = Math.max(0, ...totals);
  const ticks = niceTicks(max);
  const yMax = ticks[ticks.length - 1] ?? 1;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = n > 0 ? plotW / n : 0;
  const barW = Math.max(2, Math.min(BAR_MAX, band * 0.64));
  const baseline = PAD.top + plotH;
  const scale = (v: number) => (v / yMax) * plotH;
  // Etiquetas del eje X ancladas a la barra actual (la de la derecha).
  const labelEvery = Math.max(1, Math.ceil(LABEL_MIN_SPACING / Math.max(band, 1)));
  const isEmpty = max === 0;
  const activePoint = active !== null ? series[active] : undefined;

  function onKeyDown(e: React.KeyboardEvent) {
    if (n === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      setActive((cur) => {
        const start = cur ?? (dir > 0 ? -1 : n);
        return Math.min(n - 1, Math.max(0, start + dir));
      });
    } else if (e.key === "Escape") {
      setActive(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="text-sm font-semibold">Mensajes recibidos {UNIT_TITLE[unit]}</h3>
        <div className="flex items-center gap-4">
          <ul className="flex items-center gap-3 text-xs text-text-2" aria-label="Canales">
            {STACK.map((ch) => (
              <li key={ch} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 rounded-[3px]"
                  style={{ background: CHANNEL_SERIES[ch].color }}
                />
                {CHANNEL_SERIES[ch].label}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            data-testid="metrics-table-toggle"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium transition-colors",
              showTable ? "bg-brand-tint text-brand-text" : "text-text-2 hover:bg-accent"
            )}
          >
            <Table2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden />
            {showTable ? "Ver gráfico" : "Ver tabla"}
          </button>
        </div>
      </div>

      {showTable ? (
        <DataTable series={series} unit={unit} />
      ) : (
        <div
          ref={wrapRef}
          className="relative w-full select-none outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-sm"
          style={{ height: HEIGHT }}
          tabIndex={0}
          role="group"
          aria-label={`Mensajes recibidos ${UNIT_TITLE[unit]}, apilados por canal. Usá las flechas para recorrer las barras.`}
          onKeyDown={onKeyDown}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          data-testid="metrics-chart"
        >
          {width > 0 && (
            <svg width={width} height={HEIGHT} className="block" aria-hidden>
              {/* Grilla recesiva + valores redondos del eje Y. */}
              {ticks.map((t) => {
                const y = baseline - scale(t);
                return (
                  <g key={t}>
                    <line
                      x1={PAD.left}
                      x2={width - PAD.right}
                      y1={Math.round(y) + 0.5}
                      y2={Math.round(y) + 0.5}
                      stroke="var(--border)"
                      strokeWidth={1}
                    />
                    <text
                      x={PAD.left - 8}
                      y={y}
                      dy="0.32em"
                      textAnchor="end"
                      className="fill-[var(--text-3)] text-[11px] tabular-nums"
                    >
                      {formatCount(t)}
                    </text>
                  </g>
                );
              })}

              {series.map((p, i) => {
                const x0 = PAD.left + i * band;
                const x = x0 + (band - barW) / 2;
                let top = baseline;
                const segments: React.ReactNode[] = [];
                const visible = STACK.filter((ch) => p[ch] > 0);
                visible.forEach((ch, j) => {
                  // Un valor chico igual se ve (2 px); el hueco de 2 px de
                  // superficie separa los segmentos apilados.
                  const gap = j > 0 ? GAP : 0;
                  const h = Math.max(2, scale(p[ch]) - gap);
                  const y = top - gap - h;
                  const isTop = j === visible.length - 1;
                  segments.push(
                    <path
                      key={ch}
                      d={isTop ? topRoundedBar(x, y, barW, h) : `M${x},${y + h} V${y} H${x + barW} V${y + h} Z`}
                      fill={CHANNEL_SERIES[ch].color}
                    />
                  );
                  top = y;
                });
                const showLabel = (n - 1 - i) % labelEvery === 0;
                return (
                  <g key={p.key}>
                    {active === i && (
                      <rect
                        x={x0 + 1}
                        y={PAD.top}
                        width={Math.max(0, band - 2)}
                        height={plotH}
                        rx={4}
                        fill="var(--bg-hover)"
                      />
                    )}
                    {segments}
                    {showLabel && (
                      <text
                        x={x0 + band / 2}
                        y={baseline + 16}
                        textAnchor="middle"
                        className={cn(
                          "text-[11px] tabular-nums",
                          active === i ? "fill-[var(--text)]" : "fill-[var(--text-3)]"
                        )}
                      >
                        {bucketAxisLabel(p.key, unit)}
                      </text>
                    )}
                    {/* Blanco del puntero: toda la franja, no solo la barra. */}
                    <rect
                      x={x0}
                      y={PAD.top}
                      width={band}
                      height={plotH + PAD.bottom}
                      fill="transparent"
                      onPointerEnter={() => setActive(i)}
                      onPointerMove={() => setActive(i)}
                      data-testid={`metrics-bar-${p.key}`}
                    />
                  </g>
                );
              })}

              {/* Línea base, un paso más marcada que la grilla. */}
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={baseline + 0.5}
                y2={baseline + 0.5}
                stroke="var(--border-strong)"
                strokeWidth={1}
              />
            </svg>
          )}

          {isEmpty && width > 0 && (
            <p
              className="pointer-events-none absolute inset-x-0 text-center text-sm text-text-3"
              style={{ top: PAD.top + plotH / 2 - 10, paddingLeft: PAD.left }}
            >
              Sin mensajes recibidos en este período.
            </p>
          )}

          {activePoint && active !== null && (
            <Tooltip
              point={activePoint}
              unit={unit}
              isCurrent={active === n - 1}
              centerX={PAD.left + active * band + band / 2}
              halfBand={band / 2}
              containerWidth={width}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Tooltip({
  point,
  unit,
  isCurrent,
  centerX,
  halfBand,
  containerWidth,
}: {
  point: SeriesPoint;
  unit: BucketUnit;
  isCurrent: boolean;
  centerX: number;
  halfBand: number;
  containerWidth: number;
}) {
  const TIP_W = 184;
  // Al costado de la barra (a la derecha si entra, si no a la izquierda):
  // encima taparía justo la barra que se está leyendo.
  const right = centerX + halfBand + 6;
  const left =
    right + TIP_W <= containerWidth
      ? right
      : Math.max(0, centerX - halfBand - 6 - TIP_W);
  const total = point.whatsapp + point.instagram;
  return (
    <div
      role="status"
      data-testid="metrics-tooltip"
      className="pointer-events-none absolute top-0 z-10 rounded-md border bg-background px-3 py-2 text-xs shadow-pop"
      style={{ left, width: TIP_W }}
    >
      <div className="mb-1.5 text-text-3">
        {unit === "week" ? "Semana del " : ""}
        {bucketLongLabel(point.key, unit)}
        {isCurrent ? " (en curso)" : ""}
      </div>
      <ul className="flex flex-col gap-1">
        {[...STACK].reverse().map((ch) => (
          <li key={ch} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-[2px] w-3 rounded-full"
              style={{ background: CHANNEL_SERIES[ch].color }}
            />
            <span className="font-semibold tabular-nums text-foreground">{formatCount(point[ch])}</span>
            <span className="text-text-2">{CHANNEL_SERIES[ch].label}</span>
          </li>
        ))}
        <li className="mt-0.5 flex items-center gap-2 border-t pt-1.5">
          <span aria-hidden className="inline-block w-3" />
          <span className="font-semibold tabular-nums text-foreground">{formatCount(total)}</span>
          <span className="text-text-2">Total</span>
        </li>
      </ul>
    </div>
  );
}

function DataTable({ series, unit }: { series: SeriesPoint[]; unit: BucketUnit }) {
  const rows = [...series].reverse();
  return (
    <div className="max-h-[320px] overflow-auto rounded-sm border" data-testid="metrics-table">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-subtle text-left text-xs text-text-3">
          <tr>
            <th className="px-3 py-2 font-medium">{unit === "day" ? "Día" : unit === "week" ? "Semana" : "Mes"}</th>
            <th className="px-3 py-2 text-right font-medium">WhatsApp</th>
            <th className="px-3 py-2 text-right font-medium">Instagram</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((p, i) => (
            <tr key={p.key} className="border-t">
              <td className="px-3 py-1.5 text-text-2">
                {bucketLongLabel(p.key, unit)}
                {i === 0 ? " (en curso)" : ""}
              </td>
              <td className="px-3 py-1.5 text-right">{formatCount(p.whatsapp)}</td>
              <td className="px-3 py-1.5 text-right">{formatCount(p.instagram)}</td>
              <td className="px-3 py-1.5 text-right font-medium">{formatCount(p.whatsapp + p.instagram)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
