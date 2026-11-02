"use client";

import Link from "next/link";
import { BellOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatCount, formatDuration } from "@/lib/metrics";
import { formatAgo, pushStatusText, type MemberAttentionRow } from "@/lib/team-attention";

/**
 * 048: la tarjeta de una persona — la misma en Métricas → Equipo (el
 * propietario ve a todos) y en Ajustes → Mi atención (cada uno, la suya).
 */
export function PersonAttention({
  row,
  lateMinutes,
  self = false,
}: {
  row: MemberAttentionRow;
  lateMinutes: number;
  /** En «Mi atención»: el aviso de push enlaza a Notificaciones. */
  self?: boolean;
}) {
  const noPush = row.push.devices === 0;
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="attention-person">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-semibold" data-testid="attention-person-name">
          {row.name || "Sin nombre"}
        </span>
        <span className="text-xs text-text-3">
          {row.role === "owner"
            ? "Propietario"
            : row.role === "member"
              ? "Miembro"
              : "Ya no está en el equipo"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
        <Stat label="Esperas respondidas" testId="attention-person-waits">
          {formatCount(row.waitsAnswered)}
          {row.waitsLate > 0 && (
            <span className="ml-1 text-xs font-normal text-destructive" data-testid="attention-person-late">
              ({row.waitsLate} tarde)
            </span>
          )}
        </Stat>
        <Stat label="Mediana de respuesta" testId="attention-person-median">
          {formatDuration(row.medianResponseMs)}
        </Stat>
        <Stat label="Conversaciones" testId="attention-person-conversations">
          {formatCount(row.conversations)}
        </Stat>
        <Stat label="Mensajes" testId="attention-person-messages">
          {formatCount(row.messages)}
        </Stat>
      </dl>

      <div className="flex flex-col gap-1 border-t pt-3 text-xs text-text-2">
        <span data-testid="attention-person-last-message">
          Último mensaje: <span className="text-foreground">{formatAgo(row.lastMessageAt)}</span>
        </span>
        {row.role !== null && (
          <span data-testid="attention-person-last-seen">
            Última vez en el CRM: <span className="text-foreground">{formatAgo(row.lastSeenAt)}</span>
          </span>
        )}
        {row.role !== null && (
          <span
            data-testid="attention-person-push"
            className={cn("inline-flex items-center gap-1", noPush && "font-medium text-warning")}
          >
            {noPush && <BellOff className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />}
            {pushStatusText(row.push)}
            {noPush && self && (
              <Link href="/settings/notifications" className="ml-1 underline underline-offset-2">
                Activarlas
              </Link>
            )}
          </span>
        )}
      </div>
      {row.waitsLate > 0 && (
        <p className="sr-only">Tarde = más de {lateMinutes} minutos.</p>
      )}
    </Card>
  );
}

function Stat({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs leading-tight text-text-3">{label}</dt>
      <dd className="text-base font-semibold" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}
