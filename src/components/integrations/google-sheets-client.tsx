"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ExternalLink,
  FilePlus2,
  FolderOpen,
  Link2,
  Plus,
  RefreshCw,
  Receipt,
  Sheet,
  Trash2,
  Unplug,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSpreadsheetPicker } from "@/components/integrations/google-picker";

/**
 * Página de Google Sheets (034): conexión OAuth (`drive.file`), comprobantes
 * de transferencia a la planilla de conciliación (US2) y planillas que el
 * agente consulta (US3). Solo el propietario llega acá (022). Jamás se
 * muestra ni se pide un token.
 */

type Integration = {
  accountEmail: string | null;
  status: "connected" | "reconnect_required";
  connectedAt: string;
  receipts: {
    enabled: boolean;
    spreadsheetId: string | null;
    spreadsheetName: string | null;
    sheetTitle: string | null;
    url: string | null;
  };
};

type Source = {
  id: string;
  spreadsheetId: string;
  spreadsheetName: string;
  sheetTitle: string;
  description: string;
  enabled: boolean;
  rowCount: number;
  truncated: boolean;
  fetchedAt: string | null;
  lastError: string | null;
  url: string;
  preview: string[][];
};

type Data = {
  available: boolean;
  pickerAvailable: boolean;
  integration: Integration | null;
  sources: Source[];
};

type SpreadsheetInfo = {
  spreadsheetId: string;
  title: string;
  sheets: { title: string; rowCount: number; columnCount: number }[];
};

type LogItem = {
  id: string;
  status: "pending" | "recorded" | "duplicate" | "failed";
  error: string | null;
  errorText: string | null;
  contactName: string | null;
  conversationId: string;
  updatedRange: string | null;
  spreadsheetId: string | null;
  createdAt: string;
};

const ERROR_TEXT: Record<string, string> = {
  cancelled: "Cancelaste la autorización en Google. No se conectó nada.",
  state: "La autorización no coincide con tu sesión. Volvé a intentar desde este botón.",
  exchange: "Google no completó la autorización. Revisá la configuración de la app e intentá de nuevo.",
  forbidden: "Solo el propietario puede conectar la integración.",
};

const SOURCE_ERROR: Record<string, string> = {
  reconnect_required: "Google pidió volver a conectar la cuenta.",
  no_access: "Vocero perdió el acceso a esta planilla. Quitala y volvé a elegirla con el selector.",
  not_found: "La planilla o la pestaña ya no existe.",
  provider_error: "Google no respondió en la última actualización.",
};

async function errorMessage(res: Response | null, fallback: string): Promise<string> {
  if (!res) return fallback;
  const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return j?.error?.message ?? fallback;
}

function when(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

export function GoogleSheetsClient() {
  const params = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onError = useCallback((m: string | null) => setError(m), []);
  const picker = useSpreadsheetPicker((m) => setError(m));

  const refetch = useCallback(async () => {
    const res = await fetch("/api/integrations/google-sheets").catch(() => null);
    if (!res?.ok) return;
    setData((await res.json()) as Data);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (params.get("connected") === "1") setNotice("Google Sheets conectado.");
    const e = params.get("error");
    if (e) setError(ERROR_TEXT[e] ?? "No se pudo conectar.");
  }, [params]);

  if (!data) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  const connected = data.integration?.status === "connected";

  return (
    <div className="max-w-3xl space-y-6">
      {notice && (
        <p className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] px-3 py-2 text-sm text-[#3f6b52]" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-[#ecd4d2] bg-[#faf1f0] px-3 py-2 text-sm text-[#a2504c]" role="alert">
          {error}
        </p>
      )}
      <ConnectionCard data={data} onChanged={refetch} onError={onError} onNotice={setNotice} />
      {data.integration && (
        <>
          <ReceiptsCard
            data={data}
            connected={connected}
            pick={picker.pick}
            onChanged={refetch}
            onError={onError}
            onNotice={setNotice}
          />
          <SourcesCard
            data={data}
            connected={connected}
            pick={picker.pick}
            onChanged={refetch}
            onError={onError}
            onNotice={setNotice}
          />
        </>
      )}
      {picker.dialog}
    </div>
  );
}

type CardProps = {
  data: Data;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
};

/* ---------------- Conexión ---------------- */

function ConnectionCard({ data, onChanged, onError, onNotice }: CardProps) {
  const { available, integration } = data;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function disconnect() {
    setBusy(true);
    onError(null);
    const res = await fetch("/api/integrations/google-sheets", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!res?.ok) {
      onError("No se pudo desconectar.");
      return;
    }
    onNotice("Google Sheets desconectado. El agente ya no anota comprobantes ni consulta planillas.");
    await onChanged();
  }

  return (
    <Card data-testid="gs-connection">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Sheet className="h-4 w-4 text-brand" strokeWidth={1.7} />
            Conexión
          </CardTitle>
          {!available ? (
            <Badge variant="secondary">No habilitada</Badge>
          ) : !integration ? (
            <Badge variant="secondary">No conectada</Badge>
          ) : integration.status === "reconnect_required" ? (
            <Badge variant="warning">Requiere reconexión</Badge>
          ) : (
            <Badge variant="success">Conectada</Badge>
          )}
        </div>
        <CardDescription>
          {!available
            ? "El operador de esta instancia todavía no habilitó la integración con Google (faltan las credenciales de la app de Google en el entorno). Pedile que siga docs/integraciones/google-sheets-gcp.md."
            : integration
              ? `Cuenta: ${integration.accountEmail ?? "(sin email)"}`
              : "Conectá la cuenta de Google del negocio. Vocero solo puede abrir las planillas que vos elijas acá o que cree él: nunca ve el resto de tu Drive."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 px-5 pb-5">
        {available && (!integration || integration.status === "reconnect_required") && (
          <a href="/api/integrations/google-sheets/connect" data-testid="gs-connect">
            <Button>
              <Link2 className="h-4 w-4" strokeWidth={1.7} />
              {integration ? "Reconectar con Google" : "Conectar con Google"}
            </Button>
          </a>
        )}
        {integration && !confirming && (
          <Button variant="outline" onClick={() => setConfirming(true)} data-testid="gs-disconnect">
            <Unplug className="h-4 w-4" strokeWidth={1.7} />
            Desconectar
          </Button>
        )}
        {integration && confirming && (
          <span className="flex flex-wrap items-center gap-2 text-sm md:flex-nowrap">
            ¿Desconectar? El agente deja de anotar comprobantes y de consultar planillas. Tus planillas en Google no se tocan.
            <Button variant="destructive" size="sm" disabled={busy} onClick={disconnect} data-testid="gs-disconnect-confirm">
              Sí, desconectar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </span>
        )}
        {integration?.status === "reconnect_required" && (
          <p className="w-full text-xs text-[#8a6d3b]">
            Google rechazó la credencial guardada (revocada o caducada). Hasta reconectar, los comprobantes
            quedan como fallidos para reintentar y el agente usa la última copia de cada planilla. Reconectá
            con la misma cuenta para no perder el acceso a las planillas elegidas.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Selector de pestaña ---------------- */

/**
 * Después de elegir la planilla: inspección en el servidor (valida acceso)
 * y diálogo para elegir la pestaña (y, en planillas de consulta, para qué
 * sirve).
 */
function useTabChooser(onError: (m: string | null) => void) {
  const [info, setInfo] = useState<SpreadsheetInfo | null>(null);
  const inspect = useCallback(
    async (spreadsheetId: string): Promise<SpreadsheetInfo | null> => {
      const res = await fetch("/api/integrations/google-sheets/picker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheet: spreadsheetId }),
      }).catch(() => null);
      if (!res?.ok) {
        onError(await errorMessage(res, "No se pudo abrir la planilla."));
        return null;
      }
      const data = (await res.json()) as SpreadsheetInfo;
      setInfo(data);
      return data;
    },
    [onError]
  );
  return { info, setInfo, inspect };
}

/* ---------------- Comprobantes ---------------- */

function ReceiptsCard({
  data,
  connected,
  pick,
  onChanged,
  onError,
  onNotice,
}: CardProps & { connected: boolean; pick: () => Promise<{ id: string; name: string } | null> }) {
  const receipts = data.integration!.receipts;
  const [busy, setBusy] = useState(false);
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [headersError, setHeadersError] = useState<string | null>(null);
  const [log, setLog] = useState<LogItem[]>([]);
  const chooser = useTabChooser(onError);
  const [tab, setTab] = useState("");

  const loadLog = useCallback(async () => {
    const res = await fetch("/api/integrations/google-sheets/receipts").catch(() => null);
    if (!res?.ok) return;
    const j = (await res.json()) as { headers: string[] | null; headersError: string | null; log: LogItem[] };
    setHeaders(j.headers);
    setHeadersError(j.headersError);
    setLog(j.log);
  }, []);

  useEffect(() => {
    void loadLog();
  }, [loadLog, receipts.spreadsheetId, receipts.sheetTitle]);

  async function put(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    onError(null);
    const res = await fetch("/api/integrations/google-sheets/receipts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      onError(await errorMessage(res, "No se pudo guardar."));
      return false;
    }
    const j = (await res.json().catch(() => ({}))) as { wroteHeaders?: boolean };
    onNotice(j.wroteHeaders ? `${ok} La pestaña estaba vacía: le escribimos las columnas sugeridas.` : ok);
    await onChanged();
    await loadLog();
    return true;
  }

  async function create() {
    setBusy(true);
    onError(null);
    const res = await fetch("/api/integrations/google-sheets/receipts", { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      onError(await errorMessage(res, "No se pudo crear la planilla."));
      return;
    }
    onNotice("Creamos la planilla «Comprobantes» en tu Google Drive con las columnas sugeridas.");
    await onChanged();
    await loadLog();
  }

  async function choose() {
    onError(null);
    const picked = await pick();
    if (!picked) return;
    const info = await chooser.inspect(picked.id);
    if (info) setTab(info.sheets[0]?.title ?? "");
  }

  async function retry(id: string) {
    const res = await fetch(`/api/integrations/google-sheets/receipts/${id}/retry`, { method: "POST" }).catch(() => null);
    if (!res?.ok) onError(await errorMessage(res, "No se pudo reintentar."));
    await loadLog();
  }

  return (
    <Card data-testid="gs-receipts">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-brand" strokeWidth={1.7} />
              Comprobantes de transferencia
            </CardTitle>
            <CardDescription>
              Cuando un cliente manda la foto o el PDF de un comprobante, se lee completo y se agrega una fila a
              tu planilla para conciliar después. El agente solo sabe que quedó anotado: los datos bancarios
              nunca entran a la conversación.
            </CardDescription>
          </div>
          <button
            role="switch"
            aria-checked={receipts.enabled}
            aria-label="Anotar comprobantes"
            data-testid="gs-receipts-switch"
            disabled={busy || !receipts.spreadsheetId}
            onClick={() =>
              void put(
                { enabled: !receipts.enabled },
                receipts.enabled ? "Ya no se anotan comprobantes." : "Se anotan los comprobantes."
              )
            }
            className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
              receipts.enabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                receipts.enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-5 pb-5">
        {receipts.spreadsheetId ? (
          <div className="space-y-2 text-sm" data-testid="gs-receipts-target">
            <p>
              Destino:{" "}
              <a href={receipts.url ?? "#"} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                {receipts.spreadsheetName} › {receipts.sheetTitle}
                <ExternalLink className="ml-1 inline h-3 w-3" />
              </a>
            </p>
            {headers && headers.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">Columnas (fila 1 de la pestaña):</p>
                <div className="mt-1 flex flex-wrap gap-1" data-testid="gs-receipts-headers">
                  {headers.map((h) => (
                    <Badge key={h} variant="secondary">
                      {h}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {headersError && <p className="text-xs text-[#a2504c]">{headersError}</p>}
            <p className="text-xs text-muted-foreground">
              Recibido, Contacto (o Cliente), Teléfono y Conversación los completa Vocero. El resto lo lee la IA del
              comprobante; para indicarle cómo completar cada columna (formato de fecha, qué poner en
              Concepto…), escribilo en el{" "}
              <Link href="/agent" className="underline">
                conocimiento del agente
              </Link>
              . Podés agregar, quitar o renombrar columnas en la planilla cuando quieras.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Elegí dónde anotar los comprobantes.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant={receipts.spreadsheetId ? "outline" : "default"} disabled={busy || !connected} onClick={create} data-testid="gs-receipts-create">
            <FilePlus2 className="h-4 w-4" strokeWidth={1.7} />
            Crear planilla nueva
          </Button>
          <Button
            variant="outline"
            disabled={busy || !connected || !data.pickerAvailable}
            onClick={choose}
            data-testid="gs-receipts-choose"
          >
            <FolderOpen className="h-4 w-4" strokeWidth={1.7} />
            Elegir una planilla existente
          </Button>
        </div>
        {!data.pickerAvailable && (
          <p className="text-xs text-muted-foreground">
            Elegir una planilla existente requiere que el operador habilite el selector de Google.
          </p>
        )}

        {log.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Últimos comprobantes</p>
            <ul className="divide-y rounded-md border text-sm" data-testid="gs-receipts-log">
              {log.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid={`gs-receipt-${r.status}`}>
                  <span className="min-w-0">
                    <ReceiptBadge status={r.status} />{" "}
                    <Link href={`/inbox?c=${r.conversationId}`} className="hover:underline">
                      {r.contactName ?? "Contacto"}
                    </Link>{" "}
                    <span className="text-xs text-muted-foreground">· {when(r.createdAt)}</span>
                    {r.updatedRange && <span className="text-xs text-muted-foreground"> · {r.updatedRange}</span>}
                    {r.errorText && <span className="block text-xs text-[#a2504c]">{r.errorText}</span>}
                  </span>
                  {r.status === "failed" && (
                    <Button size="sm" variant="outline" onClick={() => void retry(r.id)} data-testid="gs-receipt-retry">
                      <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />
                      Reintentar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      <Dialog
        open={chooser.info !== null}
        onClose={() => chooser.setInfo(null)}
        title={`¿En qué pestaña de «${chooser.info?.title ?? ""}»?`}
        description="La fila 1 de la pestaña tiene que tener los encabezados. Si está vacía, escribimos las columnas sugeridas."
        testId="gs-receipts-tab-dialog"
        footer={
          <Button
            disabled={busy || !tab}
            data-testid="gs-receipts-tab-save"
            onClick={async () => {
              const info = chooser.info;
              if (!info) return;
              if (await put({ spreadsheetId: info.spreadsheetId, sheetTitle: tab }, "Destino guardado: se anotan los comprobantes.")) {
                chooser.setInfo(null);
              }
            }}
          >
            Usar esta pestaña
          </Button>
        }
      >
        <TabSelect info={chooser.info} value={tab} onChange={setTab} />
      </Dialog>
    </Card>
  );
}

function ReceiptBadge({ status }: { status: LogItem["status"] }) {
  if (status === "recorded") return <Badge variant="success">Anotado</Badge>;
  if (status === "duplicate") return <Badge variant="secondary">Repetido</Badge>;
  if (status === "failed") return <Badge variant="warning">Fallido</Badge>;
  return <Badge variant="secondary">En curso</Badge>;
}

function TabSelect({
  info,
  value,
  onChange,
}: {
  info: SpreadsheetInfo | null;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor="gs-tab">Pestaña</Label>
      <select
        id="gs-tab"
        data-testid="gs-tab-select"
        className="h-10 w-full rounded-md border bg-background px-3 text-base md:text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {(info?.sheets ?? []).map((s) => (
          <option key={s.title} value={s.title}>
            {s.title}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ---------------- Planillas de consulta ---------------- */

function SourcesCard({
  data,
  connected,
  pick,
  onChanged,
  onError,
  onNotice,
}: CardProps & { connected: boolean; pick: () => Promise<{ id: string; name: string } | null> }) {
  const chooser = useTabChooser(onError);
  const [tab, setTab] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    onError(null);
    const picked = await pick();
    if (!picked) return;
    const info = await chooser.inspect(picked.id);
    if (info) {
      setTab(info.sheets[0]?.title ?? "");
      setDescription("");
    }
  }

  async function save() {
    const info = chooser.info;
    if (!info) return;
    setBusy(true);
    const res = await fetch("/api/integrations/google-sheets/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spreadsheetId: info.spreadsheetId, sheetTitle: tab, description }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      onError(await errorMessage(res, "No se pudo agregar la planilla."));
      return;
    }
    chooser.setInfo(null);
    onNotice("Planilla agregada: el agente ya la consulta.");
    await onChanged();
  }

  return (
    <Card data-testid="gs-sources">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sheet className="h-4 w-4 text-brand" strokeWidth={1.7} />
          Planillas que consulta el agente
        </CardTitle>
        <CardDescription>
          Información que cambia seguido —precios, stock, cupos, fechas— sin tocar el conocimiento del agente.
          El agente lee una copia que se actualiza sola cada 5 minutos cuando hace falta. Solo lectura: nunca
          escribe en estas planillas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-5 pb-5">
        {data.sources.map((s) => (
          <SourceRow key={s.id} source={s} onChanged={onChanged} onError={onError} />
        ))}
        <Button
          variant="outline"
          disabled={!connected || !data.pickerAvailable}
          onClick={add}
          data-testid="gs-sources-add"
        >
          <Plus className="h-4 w-4" strokeWidth={1.7} />
          Agregar planilla
        </Button>
        {!data.pickerAvailable && (
          <p className="text-xs text-muted-foreground">
            Agregar planillas requiere que el operador habilite el selector de Google.
          </p>
        )}
      </CardContent>

      <Dialog
        open={chooser.info !== null}
        onClose={() => chooser.setInfo(null)}
        title={`Agregar «${chooser.info?.title ?? ""}»`}
        testId="gs-source-dialog"
        footer={
          <Button disabled={busy || !tab} onClick={save} data-testid="gs-source-save">
            Agregar
          </Button>
        }
      >
        <div className="space-y-3">
          <TabSelect info={chooser.info} value={tab} onChange={setTab} />
          <div className="space-y-1">
            <Label htmlFor="gs-desc">¿Para qué sirve? (le ayuda al agente a saber cuándo usarla)</Label>
            <Textarea
              id="gs-desc"
              data-testid="gs-source-description"
              value={description}
              maxLength={500}
              placeholder="Ej.: precios por temporada de cada cabaña"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

function SourceRow({
  source,
  onChanged,
  onError,
}: {
  source: Source;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState(source.description);
  const [confirming, setConfirming] = useState(false);

  async function call(method: "PATCH" | "POST" | "DELETE", body?: unknown) {
    setBusy(true);
    onError(null);
    const res = await fetch(`/api/integrations/google-sheets/sources/${source.id}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) onError(await errorMessage(res, "No se pudo guardar."));
    await onChanged();
  }

  const [header = [], ...rows] = source.preview;
  return (
    <div className="space-y-2 rounded-md border p-3" data-testid={`gs-source-${source.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a href={source.url} target="_blank" rel="noreferrer" className="min-w-0 font-medium hover:underline">
          {source.spreadsheetName} › {source.sheetTitle}
          <ExternalLink className="ml-1 inline h-3 w-3" />
        </a>
        <div className="flex items-center gap-2">
          {!source.enabled && <Badge variant="secondary">Pausada</Badge>}
          {source.lastError && <Badge variant="warning">Error</Badge>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="gs-source-meta">
        {Math.max(0, source.rowCount - 1)} filas{source.truncated ? " (copia recortada)" : ""} · actualizada{" "}
        {when(source.fetchedAt)}
      </p>
      {source.lastError && (
        <p className="text-xs text-[#a2504c]" data-testid="gs-source-error">
          {SOURCE_ERROR[source.lastError] ?? source.lastError} El agente usa la última copia.
        </p>
      )}
      {header.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {header.map((h, i) => (
                  <th key={i} className="whitespace-nowrap px-2 py-1 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  {header.map((_, j) => (
                    <td key={j} className="whitespace-nowrap px-2 py-1 text-muted-foreground">
                      {r[j] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Textarea
        value={description}
        maxLength={500}
        placeholder="¿Para qué sirve esta planilla?"
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => {
          if (description !== source.description) void call("PATCH", { description });
        }}
        data-testid="gs-source-desc-edit"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void call("POST")} data-testid="gs-source-refresh">
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} />
          Actualizar ahora
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void call("PATCH", { enabled: !source.enabled })} data-testid="gs-source-toggle">
          {source.enabled ? "Pausar" : "Reanudar"}
        </Button>
        {!confirming ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(true)} data-testid="gs-source-delete">
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
            Quitar
          </Button>
        ) : (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void call("DELETE")} data-testid="gs-source-delete-confirm">
            Sí, quitar
          </Button>
        )}
      </div>
    </div>
  );
}
