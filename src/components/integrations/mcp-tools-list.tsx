"use client";

import { useState } from "react";
import { PenLine, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * Herramientas del servidor con su estado y su interruptor (032).
 *
 * Lo que publica el servidor en cada «Verificar conexión» aparece acá solo,
 * sin un deploy. Las de CONSULTA quedan activas por defecto; las que
 * ESCRIBEN en el sistema del cliente quedan «pendientes de aprobar» y se
 * activan con un clic + confirmación. Las que usa el perfil del proveedor se
 * muestran como tales (las gobierna «Herramientas del agente»).
 *
 * La usan Integraciones (propietario, `PATCH /api/integrations/mcp`) y
 * Administración (super admin, `PATCH /api/admin/organizations/[id]/mcp`).
 */

export type McpToolItem = {
  name: string;
  title?: string | null;
  description: string | null;
  readOnly: boolean;
  kind?: "read" | "write";
  state?: "profile" | "active" | "pending" | "off" | "stale";
  paramCount?: number;
};

const STATE_BADGE: Record<
  NonNullable<McpToolItem["state"]>,
  { label: string; variant: "success" | "warning" | "secondary" | "outline" }
> = {
  profile: { label: "La usa el perfil", variant: "secondary" },
  active: { label: "Activa", variant: "success" },
  pending: { label: "Pendiente de aprobar", variant: "warning" },
  off: { label: "Apagada", variant: "outline" },
  stale: { label: "Verificá la conexión", variant: "outline" },
};

export function McpToolsList({
  tools,
  canManage,
  endpoint,
  onChanged,
  onError,
  agentToolsEnabled = true,
}: {
  tools: McpToolItem[];
  canManage: boolean;
  /** URL del PATCH `{tool, enabled}`. */
  endpoint: string;
  onChanged: () => Promise<void> | void;
  onError: (message: string | null) => void;
  /** Con el interruptor general apagado, nada llega al agente. */
  agentToolsEnabled?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<McpToolItem | null>(null);

  async function decide(tool: McpToolItem, enabled: boolean) {
    setBusy(tool.name);
    onError(null);
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: tool.name, enabled }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      onError(body?.error?.message ?? "No se pudo guardar el cambio. Probá de nuevo.");
      return;
    }
    await onChanged();
  }

  if (tools.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">El servidor no declaró ninguna herramienta.</p>
    );
  }

  const pendingCount = tools.filter((t) => t.state === "pending").length;

  return (
    <div className="space-y-2" data-testid="mcp-tools">
      {pendingCount > 0 && (
        <p
          className="rounded-md border border-[#ece2cf] bg-[#faf7f0] px-3 py-2 text-xs text-[#8a6d3b]"
          data-testid="mcp-tools-pending"
        >
          {pendingCount === 1
            ? "Hay 1 herramienta que escribe en el sistema esperando aprobación."
            : `Hay ${pendingCount} herramientas que escriben en el sistema esperando aprobación.`}{" "}
          Hasta que la actives, el agente no la usa.
        </p>
      )}
      {tools.some((t) => t.state === "stale") && (
        <p
          className="rounded-md border px-3 py-2 text-xs text-muted-foreground"
          data-testid="mcp-tools-stale"
        >
          Hay herramientas guardadas antes de esta versión, sin sus parámetros. Tocá «Verificar
          conexión» para actualizarlas: hasta entonces el agente no las usa.
        </p>
      )}
      {!agentToolsEnabled && (
        <p className="text-xs text-muted-foreground">
          «Herramientas del agente» está apagado: ninguna de estas llega al agente.
        </p>
      )}
      <ul className="space-y-2">
        {tools.map((tool) => {
          const state = tool.state ?? (tool.readOnly ? "active" : "pending");
          const kind = tool.kind ?? (tool.readOnly ? "read" : "write");
          const badge = STATE_BADGE[state];
          const KindIcon = kind === "write" ? PenLine : Search;
          return (
            <li
              key={tool.name}
              className="rounded-md border p-3"
              data-testid={`mcp-tool-${tool.name}`}
              data-state={state}
            >
              <div className="flex flex-wrap items-center gap-2">
                <KindIcon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} aria-hidden />
                <code className="break-all text-xs font-medium">{tool.name}</code>
                <Badge variant={kind === "write" ? "warning" : "secondary"}>
                  {kind === "write" ? "Escribe" : "Consulta"}
                </Badge>
                <Badge variant={badge.variant} data-testid={`mcp-tool-state-${tool.name}`}>
                  {badge.label}
                </Badge>
                <span className="flex-1" />
                {canManage && state !== "profile" && state !== "stale" && (
                  <>
                    {state === "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void decide(tool, false)}
                        data-testid={`mcp-tool-off-${tool.name}`}
                      >
                        Apagar
                      </Button>
                    )}
                    {(state === "pending" || state === "off") && (
                      <Button
                        size="sm"
                        variant={state === "pending" ? "default" : "outline"}
                        disabled={busy !== null}
                        onClick={() =>
                          kind === "write" ? setConfirming(tool) : void decide(tool, true)
                        }
                        data-testid={`mcp-tool-on-${tool.name}`}
                      >
                        {state === "pending" ? "Aprobar" : "Activar"}
                      </Button>
                    )}
                  </>
                )}
              </div>
              {tool.title && <p className="mt-1 text-sm">{tool.title}</p>}
              {tool.description && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Descripción del proveedor (sin verificar)
                    {tool.paramCount ? ` · ${tool.paramCount} parámetros` : ""}
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                    {tool.description}
                  </p>
                </details>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Aprobar una herramienta que escribe"
        description={confirming ? confirming.title ?? confirming.name : undefined}
        testId="mcp-tool-approve-dialog"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirming(null)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                const tool = confirming;
                setConfirming(null);
                if (tool) void decide(tool, true);
              }}
              data-testid="mcp-tool-approve-confirm"
            >
              Aprobar
            </Button>
          </div>
        }
      >
        <div className="space-y-2 text-sm">
          <p>
            Con <code className="text-xs">{confirming?.name}</code> el agente registra algo REAL en
            el sistema del negocio (por ejemplo, una reserva pendiente de seña).
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Solo la usa cuando el cliente, en su último mensaje, da su conformidad explícita
              («sí, confirmo»). El CRM lo verifica antes de llamar.
            </li>
            <li>Nunca la repite con los mismos datos en la misma conversación.</li>
            <li>El Laboratorio y el Entrenador jamás la ejecutan de verdad.</li>
            <li>
              Si el proveedor cambia esta herramienta, vuelve a quedar pendiente hasta que la
              apruebes de nuevo.
            </li>
          </ul>
        </div>
      </Dialog>
    </div>
  );
}
