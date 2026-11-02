"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PersonAttention } from "@/components/attention/person-attention";
import { cn } from "@/lib/utils";
import { formatCount, formatDuration, type MetricsRange } from "@/lib/metrics";
import { formatAgo, type TeamAttention, type WaitItem } from "@/lib/team-attention";

/**
 * 048: Métricas → Equipo. Cuántos clientes esperaron a una persona, cuántos
 * se respondieron a tiempo, tarde o nunca, quién espera ahora y una tarjeta
 * por persona. Mismo período y zona que el resto de la página.
 */
export function TeamSection({ range, timeZone }: { range: MetricsRange; timeZone: string }) {
  const [data, setData] = useState<TeamAttention | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    const qs = new URLSearchParams({ range, tz: timeZone });
    fetch(`/api/metrics/team?${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<TeamAttention>) : Promise.reject(r.status)))
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        console.warn("[métricas] equipo:", err);
        setError(true);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [range, timeZone, tick]);

  return (
    <section className="flex flex-col gap-3" data-testid="metrics-team" aria-labelledby="metrics-team-title">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-text-3" strokeWidth={1.7} aria-hidden />
        <h2 id="metrics-team-title" className="text-base font-semibold">
          Equipo
        </h2>
        {data && (
          <span className="text-xs text-text-3">
            Clientes que esperaron a una persona · tarde = más de {data.lateMinutes} min
          </span>
        )}
      </div>

      {error && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <span>No se pudo cargar la atención del equipo.</span>
          <button
            type="button"
            className="font-medium text-brand-text underline underline-offset-2"
            onClick={() => setTick((t) => t + 1)}
          >
            Reintentar
          </button>
        </div>
      )}

      {!data && !error ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : data ? (
        <div className={cn("flex flex-col gap-3 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <Summary data={data} />
          {data.waitingNow.length > 0 && (
            <WaitList
              title={`Esperando ahora: ${data.waitingNow.length}`}
              items={data.waitingNow}
              testId="metrics-team-waiting"
              tone="warning"
            />
          )}
          {data.problems.length > 0 && (
            <WaitList
              title="Para revisar: respondidas tarde o sin respuesta"
              items={data.problems}
              testId="metrics-team-problems"
            />
          )}
          {data.truncated && (
            <p className="text-xs text-text-3">
              Hay demasiadas esperas en este período: se muestran las 20.000 más recientes.
            </p>
          )}
          {data.people.length === 0 ? (
            <p className="text-sm text-text-3">Todavía no hay actividad del equipo en este período.</p>
          ) : (
            <div className="flex flex-col gap-3" data-testid="metrics-team-people">
              {data.people.map((p) => (
                <PersonAttention key={p.userId ?? p.name} row={p} lateMinutes={data.lateMinutes} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Summary({ data }: { data: TeamAttention }) {
  const s = data.summary;
  if (s.total === 0) {
    return (
      <Card className="p-4 text-sm text-text-2" data-testid="metrics-team-summary">
        Ningún cliente esperó a una persona en este período.
      </Card>
    );
  }
  const tiles: { label: string; value: string; testId: string; tone?: string }[] = [
    { label: "Esperas", value: formatCount(s.total), testId: "metrics-team-total" },
    { label: "A tiempo", value: formatCount(s.onTime), testId: "metrics-team-ontime" },
    {
      label: "Tarde",
      value: formatCount(s.late),
      testId: "metrics-team-late",
      tone: s.late > 0 ? "text-destructive" : undefined,
    },
    {
      label: "Sin respuesta",
      value: formatCount(s.unanswered),
      testId: "metrics-team-unanswered",
      tone: s.unanswered > 0 ? "text-destructive" : undefined,
    },
    { label: "Mediana de respuesta", value: formatDuration(s.medianResponseMs), testId: "metrics-team-median" },
  ];
  return (
    <Card className="p-4" data-testid="metrics-team-summary">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.testId} className="flex flex-col">
            <dt className="text-xs text-text-3">{t.label}</dt>
            <dd className={cn("text-2xl font-semibold leading-tight", t.tone)} data-testid={t.testId}>
              {t.value}
            </dd>
          </div>
        ))}
      </dl>
      {(s.agent > 0 || s.open > 0 || s.phone.answered > 0 || s.platform.answered > 0) && (
        <p className="mt-3 border-t pt-3 text-xs text-text-2" data-testid="metrics-team-extra">
          {[
            s.agent > 0 && `${formatCount(s.agent)} ${s.agent === 1 ? "la retomó" : "las retomó"} el agente`,
            s.open > 0 && `${formatCount(s.open)} ${s.open === 1 ? "sigue" : "siguen"} esperando`,
            s.phone.answered > 0 &&
              `${formatCount(s.phone.answered)} respondidas desde el celular (mediana ${formatDuration(s.phone.medianResponseMs)})`,
            s.platform.answered > 0 && `${formatCount(s.platform.answered)} respondidas por soporte de la plataforma`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </Card>
  );
}

function WaitList({
  title,
  items,
  testId,
  tone,
}: {
  title: string;
  items: WaitItem[];
  testId: string;
  tone?: "warning";
}) {
  return (
    <Card className="p-4" data-testid={testId}>
      <h3 className={cn("mb-2 text-sm font-semibold", tone === "warning" && "text-warning")}>{title}</h3>
      <ul className="flex flex-col divide-y">
        {items.map((w) => (
          <li key={w.waitId}>
            <Link
              href={`/inbox?c=${encodeURIComponent(w.conversationId)}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2 text-sm hover:text-brand-text"
              data-testid={`${testId}-item`}
            >
              <span className="font-medium">
                {w.contactName}
                <span className="ml-2 text-xs font-normal text-text-3">
                  {w.channel === "instagram" ? "Instagram" : "WhatsApp"} ·{" "}
                  {w.reason === "handoff" ? "derivada por el agente" : "IA apagada"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-xs text-text-2">
                <Clock className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden />
                {w.status === "open"
                  ? `espera ${formatAgo(w.startedAt)}`
                  : w.status === "expired"
                    ? "sin respuesta"
                    : `${formatDuration(w.responseMs)}${w.responderName ? ` · ${w.responderName}` : ""}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
