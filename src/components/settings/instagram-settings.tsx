"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { History, Instagram, Link2, Loader2, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Ajustes → Instagram (023): el segundo canal, al lado de WhatsApp. Conectar
 * la cuenta profesional por Business Login for Instagram, ver su estado,
 * importar el historial y desconectarla. El token jamás llega al cliente.
 */

type View = {
  igUserId: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
  status: "connected" | "reconnect_required";
  tokenExpiresAt: string;
  connectedAt: string;
  history: {
    status: "idle" | "running" | "done" | "failed";
    startedAt: string | null;
    finishedAt: string | null;
    threads: number;
    messages: number;
    error: string | null;
  };
};

type ApiResponse = { available: boolean; integration: View | null; canManage: boolean };

const ERROR_TEXT: Record<string, string> = {
  cancelled: "Cancelaste la autorización en Instagram. No se conectó nada.",
  state: "La autorización no coincide con tu sesión. Volvé a intentar desde este botón.",
  exchange:
    "Instagram no completó la autorización. Revisá que la cuenta sea profesional (de empresa o creador) e intentá de nuevo.",
  account_in_use: "Esa cuenta de Instagram ya está conectada a otra empresa de esta instancia.",
  subscribe:
    "Instagram no aceptó enviarnos los mensajes de la cuenta. Revisá en la app de Instagram: Configuración → Mensajes → Herramientas conectadas → «Permitir acceso a los mensajes».",
  forbidden: "Solo el propietario puede conectar la integración.",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function InstagramSettings() {
  const params = useSearchParams();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/integrations/instagram").catch(() => null);
    if (!res?.ok) return;
    setData((await res.json()) as ApiResponse);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Mientras importa el historial, el estado se refresca solo.
  const running = data?.integration?.history.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void refetch(), 3000);
    return () => clearInterval(t);
  }, [running, refetch]);

  async function importHistory() {
    setError(null);
    const res = await fetch("/api/integrations/instagram/history", { method: "POST" }).catch(
      () => null
    );
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "No se pudo iniciar la importación.");
      return;
    }
    await refetch();
  }

  useEffect(() => {
    if (params.get("connected") === "1") {
      setNotice("Instagram conectado. Los mensajes directos nuevos ya entran a la Bandeja.");
    }
    const e = params.get("error");
    if (e) setError(ERROR_TEXT[e] ?? "No se pudo conectar.");
  }, [params]);

  async function disconnect() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/integrations/instagram", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!res?.ok) {
      setError("No se pudo desconectar.");
      return;
    }
    setNotice("Instagram desconectado. Las conversaciones ya guardadas siguen en la Bandeja.");
    await refetch();
  }

  if (!data) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  const { available, integration, canManage } = data;
  const handle = integration?.username ? `@${integration.username}` : "la cuenta";

  return (
    // Mismo marco que el resto de Ajustes (012: en móvil el padding lo pone el layout).
    <div className="max-w-2xl space-y-6 md:p-6">
      <div>
        <h2 className="font-semibold">Instagram</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Los mensajes directos de la cuenta de Instagram del negocio entran a la misma
          Bandeja que WhatsApp y el agente los atiende con el mismo conocimiento.
        </p>
      </div>
      {notice && (
        <p
          className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] px-3 py-2 text-sm text-[#3f6b52]"
          role="status"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          className="rounded-md border border-[#ecd4d2] bg-[#faf1f0] px-3 py-2 text-sm text-[#a2504c]"
          role="alert"
        >
          {error}
        </p>
      )}

      <Card data-testid="ig-connection">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Instagram className="h-4 w-4 text-[#d62976]" strokeWidth={1.9} />
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
              ? "El operador de esta instancia todavía no habilitó Instagram (faltan INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET en el entorno). Pedile que siga docs/integraciones/instagram.md."
              : integration
                ? integration.status === "reconnect_required"
                  ? `La autorización de ${handle} venció o fue revocada. Reconectá para volver a responder desde el CRM (los mensajes entrantes se siguen guardando).`
                  : `Conectada desde el ${formatDate(integration.connectedAt)}. La autorización se renueva sola.`
                : "Conectá la cuenta profesional de Instagram del negocio. Solo pedimos permiso para leer el perfil y gestionar los mensajes directos."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 px-5 pb-5">
          {integration && (
            <div className="flex items-center gap-3" data-testid="ig-account">
              {integration.profilePictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- CDN de Meta, sin optimizador
                <img
                  src={integration.profilePictureUrl}
                  alt=""
                  className="h-10 w-10 rounded-full border object-cover"
                />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full border bg-secondary">
                  <Instagram className="h-5 w-5 text-[#d62976]" strokeWidth={1.8} />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{handle}</p>
                {integration.name && (
                  <p className="truncate text-xs text-muted-foreground">{integration.name}</p>
                )}
              </div>
            </div>
          )}

          {available && canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {(!integration || integration.status === "reconnect_required") && (
                <a href="/api/integrations/instagram/connect" data-testid="ig-connect">
                  <Button>
                    <Link2 className="h-4 w-4" strokeWidth={1.7} />
                    {integration ? "Reconectar con Instagram" : "Conectar con Instagram"}
                  </Button>
                </a>
              )}
              {integration &&
                (confirming ? (
                  <>
                    <span className="text-sm text-muted-foreground">
                      ¿Desconectar {handle}? Dejan de entrar los mensajes nuevos.
                    </span>
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void disconnect()}
                      data-testid="ig-disconnect-confirm"
                    >
                      Sí, desconectar
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setConfirming(true)}
                    data-testid="ig-disconnect"
                  >
                    <Unplug className="h-4 w-4" strokeWidth={1.7} />
                    Desconectar
                  </Button>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {integration && <HistoryCard view={integration} canManage={canManage} onImport={importHistory} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Antes de conectar</CardTitle>
          <CardDescription>Tres cosas que pide Instagram:</CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-text-2">
            <li>
              La cuenta tiene que ser <strong>profesional</strong> (de empresa o de creador). No
              hace falta una página de Facebook.
            </li>
            <li>
              En la app de Instagram: <strong>Configuración → Mensajes y respuestas a historias →
              Herramientas conectadas → «Permitir acceso a los mensajes»</strong>.
            </li>
            <li>
              Entrá con el usuario de Instagram del negocio cuando se abra la ventana de
              autorización.
            </li>
          </ol>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Cómo funciona: el agente responde dentro de las 24 h del último mensaje del
            cliente. Después de eso, solo una persona del equipo puede responder, hasta 7
            días (etiqueta de agente humano de Instagram). Instagram no tiene plantillas: no
            se puede iniciar una conversación ni hacer campañas por este canal. Lo que el
            equipo responda desde la app de Instagram también aparece en la Bandeja.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function HistoryCard({
  view,
  canManage,
  onImport,
}: {
  view: View;
  canManage: boolean;
  onImport: () => Promise<void>;
}) {
  const h = view.history;
  const [busy, setBusy] = useState(false);
  const running = h.status === "running";
  return (
    <Card data-testid="ig-history">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-brand" strokeWidth={1.7} />
            Historial
          </CardTitle>
          {running ? (
            <Badge variant="secondary">Importando…</Badge>
          ) : h.status === "done" ? (
            <Badge variant="success">Importado</Badge>
          ) : h.status === "failed" ? (
            <Badge variant="warning">Con error</Badge>
          ) : (
            <Badge variant="secondary">Sin importar</Badge>
          )}
        </div>
        <CardDescription>
          Trae a la Bandeja las conversaciones de los últimos 60 días. Instagram solo deja
          leer los <strong>20 mensajes más recientes</strong> de cada conversación, y no
          devuelve las solicitudes de mensaje sin actividad en 30 días. Lo importado no
          genera no leídos, avisos ni respuestas del agente, y no se duplica si lo volvés a
          importar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-5 pb-5">
        {(running || h.status === "done" || h.status === "failed") && (
          <p className="text-sm text-text-2" data-testid="ig-history-status">
            {running
              ? `Importando… ${h.threads} conversaciones y ${h.messages} mensajes hasta ahora.`
              : h.status === "done"
                ? h.messages === 0 && h.error
                  ? h.error
                  : `${h.threads} conversaciones y ${h.messages} mensajes importados${h.finishedAt ? ` el ${formatDate(h.finishedAt)}` : ""}.`
                : `La importación se cortó: ${h.error ?? "error desconocido"}. Lo que alcanzó a entrar quedó guardado (${h.messages} mensajes).`}
          </p>
        )}
        {canManage && view.status === "connected" && (
          <Button
            variant="outline"
            disabled={busy || running}
            onClick={async () => {
              setBusy(true);
              await onImport();
              setBusy(false);
            }}
            data-testid="ig-history-import"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} />
            ) : (
              <History className="h-4 w-4" strokeWidth={1.7} />
            )}
            {h.status === "idle" ? "Importar historial" : "Volver a importar"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
