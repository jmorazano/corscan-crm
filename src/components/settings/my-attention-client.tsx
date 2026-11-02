"use client";

import { useEffect, useMemo, useState } from "react";
import { PersonAttention } from "@/components/attention/person-attention";
import { cn } from "@/lib/utils";
import { DEFAULT_METRICS_TIMEZONE, METRICS_RANGES, RANGE_SPECS, type MetricsRange } from "@/lib/metrics";
import type { MyAttention } from "@/lib/team-attention";

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_METRICS_TIMEZONE;
  } catch {
    return DEFAULT_METRICS_TIMEZONE;
  }
}

/**
 * 048: «Mi atención» — los números de quien la abre, con el mismo formato
 * que ve el propietario en Métricas → Equipo. Nunca los de otra persona.
 */
export function MyAttentionClient() {
  const [range, setRange] = useState<MetricsRange>("day");
  const [data, setData] = useState<MyAttention | null>(null);
  const [error, setError] = useState(false);
  const timeZone = useMemo(() => browserTimeZone(), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(false);
    const qs = new URLSearchParams({ range, tz: timeZone });
    fetch(`/api/me/attention?${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<MyAttention>) : Promise.reject(r.status)))
      .then(setData)
      .catch(() => {
        if (!ctrl.signal.aborted) setError(true);
      });
    return () => ctrl.abort();
  }, [range, timeZone]);

  return (
    <div className="max-w-2xl space-y-4" data-testid="my-attention">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Mi atención</h1>
        <p className="text-sm text-muted-foreground">
          Cuántos clientes que esperaban a una persona respondiste primero y cuánto tardaste. Es lo mismo que
          ve el propietario de la empresa.
        </p>
      </div>
      <div role="radiogroup" aria-label="Período" className="inline-flex rounded-md border bg-subtle p-0.5">
        {METRICS_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={r === range}
            data-testid={`my-attention-range-${r}`}
            onClick={() => setRange(r)}
            className={cn(
              "rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors",
              r === range ? "bg-background text-foreground shadow-sm" : "text-text-2 hover:text-foreground"
            )}
          >
            {RANGE_SPECS[r].label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="text-sm text-destructive">No se pudieron cargar tus números.</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <>
          <p className="text-xs text-text-3">
            {RANGE_SPECS[data.range].period} · tarde = más de {data.lateMinutes} min
          </p>
          <PersonAttention row={data.me} lateMinutes={data.lateMinutes} self />
        </>
      )}
    </div>
  );
}
