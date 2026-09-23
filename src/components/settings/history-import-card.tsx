"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ImportDto = {
  status: "idle" | "requested" | "receiving" | "done" | "failed" | "declined";
  days: number;
  progress: number;
  importedMessages: number;
  skippedOld: number;
  threads: number;
  requestedAt: string | null;
  finishedAt: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
};

const STATUS_LABEL: Record<ImportDto["status"], string> = {
  idle: "Sin importar",
  requested: "Solicitado a Meta",
  receiving: "Recibiendo…",
  done: "Importado",
  failed: "Falló",
  declined: "Rechazado por el negocio",
};

const DAYS = 60;

/**
 * Tarjeta «Historial del celular» (017): pide a Meta la sincronización de
 * coexistence y muestra el avance. Mientras recibe, refresca sola.
 */
export function HistoryImportCard() {
  const [data, setData] = useState<ImportDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/whatsapp/history-import").catch(() => null);
    if (!res?.ok) return;
    const json = (await res.json()) as { import: ImportDto | null };
    setData(json.import);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const active = data?.status === "requested" || data?.status === "receiving";
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refetch(), 2500);
    return () => clearInterval(t);
  }, [active, refetch]);

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

  const status = data?.status ?? "idle";
  const badgeVariant =
    status === "done" ? "success" : status === "failed" || status === "declined" ? "destructive" : "secondary";

  return (
    <Card data-testid="history-import-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" strokeWidth={1.7} /> Historial del celular
          </CardTitle>
          {loaded && (
            <Badge variant={badgeVariant} data-testid="history-import-status">
              {STATUS_LABEL[status]}
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
              {status === "requested"
                ? "Esperando que Meta empiece a mandar los chats…"
                : `Recibiendo… ${data?.progress ?? 0} %`}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-brand transition-[width]"
                style={{ width: `${Math.max(3, data?.progress ?? 0)}%` }}
              />
            </div>
          </div>
        )}
        {data && (status === "done" || status === "receiving") && (
          <p className="text-sm text-text-2" data-testid="history-import-counts">
            {data.importedMessages.toLocaleString("es-AR")} mensajes en{" "}
            {data.threads.toLocaleString("es-AR")} conversaciones
            {data.skippedOld > 0
              ? ` · ${data.skippedOld.toLocaleString("es-AR")} más viejos que ${data.days} días, descartados`
              : ""}
            {data.finishedAt
              ? ` · terminado el ${new Date(data.finishedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}`
              : ""}
          </p>
        )}
        {(status === "failed" || status === "declined") && data?.lastError && (
          <p className="text-sm text-destructive" data-testid="history-import-error">
            {data.lastError}
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" data-testid="history-import-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={busy || active}
            onClick={() => void start()}
            data-testid="history-import-start"
          >
            {busy
              ? "Pidiendo…"
              : status === "done" || status === "failed" || status === "declined"
                ? `Volver a importar (${DAYS} días)`
                : `Importar últimos ${DAYS} días`}
          </Button>
          <span className="text-xs text-text-3">
            Solo el propietario. Los mensajes ya importados no se duplican.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
