"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HISTORY_SYNC_LIMIT_TEXT, type HistoryImportView } from "@/lib/history-import";

type ImportDto = {
  status: "idle" | "requested" | "receiving" | "done" | "failed" | "declined";
  days: number;
  progress: number;
  importedMessages: number;
  skippedOld: number;
  threads: number;
  requestedAt: string | null;
  lastChunkAt: string | null;
  /** Fecha del mensaje importado más viejo (hasta dónde llega el historial). */
  oldestImportedAt?: string | null;
  finishedAt: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
};

const KIND_LABEL: Record<HistoryImportView["kind"], string> = {
  idle: "Sin importar",
  waiting: "Solicitado a Meta",
  stalled: "Sin respuesta de Meta",
  receiving: "Recibiendo…",
  paused: "Importado en parte",
  done: "Importado",
  failed: "Falló",
  declined: "Rechazado por el negocio",
};

const IDLE_VIEW: HistoryImportView = {
  kind: "idle",
  problem: null,
  canRequest: true,
  needsReconnect: false,
  windowCovered: false,
};

const shortDate = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
const dayOnly = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { dateStyle: "short" });

/**
 * Meta admite un solo pedido de historial por conexión: cuando ese pedido no
 * sirvió (o llegó tarde), lo único que queda es rehacer la conexión.
 */
function ReconnectSteps() {
  return (
    <div className="space-y-1.5 text-xs text-text-3" data-testid="history-import-reconnect">
      <p>Para volver a intentarlo hay que rehacer la conexión del número:</p>
      <ol className="list-decimal space-y-0.5 pl-4">
        <li>
          En la app de WhatsApp Business del celular: Ajustes → Cuenta →
          Plataforma de negocios → «Desconectar cuenta».
        </li>
        <li>
          Acá, volver a conectar el número con «Conectar sin perder el
          celular», aceptando compartir el historial de chats cuando el
          teléfono lo pregunte.
        </li>
      </ol>
      <p>
        Al terminar, la importación se pide sola. Entre un paso y el otro el
        número deja de atenderse en el CRM.
      </p>
    </div>
  );
}

const DAYS = 60;

/**
 * Tarjeta «Historial del celular» (017): pide a Meta la sincronización de
 * coexistence y muestra el avance. Mientras recibe, refresca sola.
 */
export function HistoryImportCard() {
  const [data, setData] = useState<ImportDto | null>(null);
  const [view, setView] = useState<HistoryImportView>(IDLE_VIEW);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/whatsapp/history-import").catch(() => null);
    if (!res?.ok) return;
    const json = (await res.json()) as {
      import: ImportDto | null;
      view?: HistoryImportView;
    };
    setData(json.import);
    setView(json.view ?? IDLE_VIEW);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // «En curso» = Meta está mandando (o por mandar). Si se quedó callada, se
  // sigue mirando de vez en cuando por si retoma, pero ya no se muestra como
  // una espera con ruedita.
  const active = view.kind === "waiting" || view.kind === "receiving";
  const quiet = view.kind === "stalled" || view.kind === "paused";
  useEffect(() => {
    if (!active && !quiet) return;
    const t = setInterval(() => void refetch(), active ? 2500 : 30_000);
    return () => clearInterval(t);
  }, [active, quiet, refetch]);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings/whatsapp/history-import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ days: DAYS }),
    }).catch(() => null);
    setBusy(false);
    if (!res) {
      setError("Sin conexión con el servidor");
      return;
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(json?.error?.message ?? "No se pudo pedir la importación");
    }
    void refetch();
  }

  const kind = view.kind;
  const badgeVariant =
    kind === "done"
      ? "success"
      : kind === "failed" || kind === "declined"
        ? "destructive"
        : kind === "stalled"
          ? "warning"
          : "secondary";
  // Un motivo conocido se explica en criollo; el texto crudo de Meta solo
  // cuando no hay nada mejor que decir.
  const errorText =
    view.problem === "sync_limit" ? HISTORY_SYNC_LIMIT_TEXT : (data?.lastError ?? null);

  return (
    <Card data-testid="history-import-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" strokeWidth={1.7} /> Historial del celular
          </CardTitle>
          {loaded && (
            <Badge variant={badgeVariant} data-testid="history-import-status">
              {KIND_LABEL[kind]}
            </Badge>
          )}
        </div>
        <CardDescription>
          Si el número sigue en tu celular (coexistence), Meta puede pasarle al
          CRM los chats de los últimos {DAYS} días: contactos, lo que te
          escribieron y lo que respondiste. Así el agente y la Bandeja no
          arrancan de cero. Hay que pedirlo dentro de las 24 horas de conectar
          el número.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {active && (
          <div className="space-y-1.5" data-testid="history-import-progress">
            <div className="flex items-center gap-2 text-sm text-text-2">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />
              {kind === "waiting"
                ? "Esperando que Meta empiece a mandar los chats…"
                : `Recibiendo… ${data?.progress ?? 0} %`}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-brand transition-[width]"
                style={{ width: `${Math.max(3, data?.progress ?? 0)}%` }}
              />
            </div>
            <p className="text-xs text-text-3" data-testid="history-import-keep-open">
              Dejá WhatsApp Business abierto en el celular hasta que termine:
              los chats salen del teléfono. El porcentaje es sobre los 180 días
              que ofrece Meta; el CRM guarda los últimos {data?.days ?? DAYS}.
            </p>
          </div>
        )}
        {kind === "stalled" && (
          <div className="space-y-2" data-testid="history-import-stalled">
            <p className="text-sm text-text-2">
              Meta aceptó el pedido
              {data?.requestedAt ? ` el ${shortDate(data.requestedAt)}` : ""}, pero
              no mandó ningún chat. Cuando funciona, empiezan a llegar en uno o
              dos minutos. Lo más probable es que en el celular no se haya
              aceptado compartir el historial al conectar el número.
            </p>
            <p className="text-sm text-text-2">{HISTORY_SYNC_LIMIT_TEXT}</p>
            <ReconnectSteps />
          </div>
        )}
        {kind === "paused" && (
          <p className="text-sm text-text-2" data-testid="history-import-paused">
            Meta dejó de mandar chats
            {data?.lastChunkAt ? ` el ${shortDate(data.lastChunkAt)}` : ""}, al{" "}
            {data?.progress ?? 0} %. Manda primero lo más reciente, así que lo
            que falta es lo más viejo. Lo recibido ya está en la Bandeja.
          </p>
        )}
        {data && (kind === "done" || kind === "receiving" || kind === "paused") && (
          <p className="text-sm text-text-2" data-testid="history-import-counts">
            {data.importedMessages.toLocaleString("es-AR")} mensajes en{" "}
            {data.threads.toLocaleString("es-AR")} conversaciones
            {data.skippedOld > 0
              ? ` · ${data.skippedOld.toLocaleString("es-AR")} más viejos que ${data.days} días, descartados`
              : ""}
            {data.finishedAt ? ` · terminado el ${shortDate(data.finishedAt)}` : ""}
          </p>
        )}
        {kind === "done" && view.windowCovered && (
          <p className="text-sm text-text-2" data-testid="history-import-covered">
            Los últimos {data?.days ?? DAYS} días están completos
            {data?.oldestImportedAt
              ? `: lo importado llega hasta el ${dayOnly(data.oldestImportedAt)}`
              : ""}
            . Meta dejó de mandar al {data?.progress ?? 0} %, pero ese
            porcentaje es sobre 180 días; lo que faltaba es más viejo y el CRM
            no lo guarda.
          </p>
        )}
        {kind === "done" && view.problem === "sync_limit" && (
          <p className="text-xs text-text-3" data-testid="history-import-once">
            {HISTORY_SYNC_LIMIT_TEXT} Lo importado queda como está.
          </p>
        )}
        {(kind === "failed" || kind === "declined") && errorText && (
          <div className="space-y-2" data-testid="history-import-error">
            <p className="text-sm text-destructive">{errorText}</p>
            {view.problem === "too_late" && (
              <p className="text-xs text-text-3">
                Meta solo permite pedir el historial dentro de las 24 horas de
                conectar el número.
              </p>
            )}
            {view.needsReconnect && <ReconnectSteps />}
          </div>
        )}
        {error && error !== errorText && error !== data?.lastError && (
          <p className="text-sm text-destructive" data-testid="history-import-error">
            {error}
          </p>
        )}
        {/* Sin botón cuando ya se sabe que Meta lo va a rechazar: vuelve
            solo si el número se reconecta. Mientras llega, se ve deshabilitado. */}
        {(view.canRequest || active) && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={busy || active}
              onClick={() => void start()}
              data-testid="history-import-start"
            >
              {busy
                ? "Pidiendo…"
                : kind === "done" || kind === "failed" || kind === "declined"
                  ? `Volver a importar (${DAYS} días)`
                  : `Importar últimos ${DAYS} días`}
            </Button>
            <span className="text-xs text-text-3">
              Solo el propietario. Los mensajes ya importados no se duplican.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
