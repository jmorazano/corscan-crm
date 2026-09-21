"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FileX2,
  Pencil,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import type { ConversationDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrainerAvatar } from "./trainer-row";
import { formatTime } from "./helpers";

type ChangeDto = {
  id: string;
  op: "kb_add" | "kb_update" | "kb_delete" | "profile_update";
  targetId: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  createdAt: string;
  revertedAt: string | null;
  messageId: string | null;
};

const OP_ICON = {
  kb_add: FilePlus2,
  kb_update: Pencil,
  kb_delete: FileX2,
  profile_update: SlidersHorizontal,
} as const;

function detail(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const v = value as Record<string, unknown>;
  if (typeof v.kind === "string") {
    return v.kind === "qa"
      ? `P: ${v.question ?? ""}\nR: ${v.answer ?? ""}`
      : String(v.content ?? "");
  }
  if ("field" in v) return String(v.value ?? "(vacío)");
  return "";
}

/**
 * Panel derecho de la conversación con el agente (015, US2): no es la ficha
 * de un contacto — muestra el estado del agente y los cambios recientes con
 * «Deshacer».
 */
export function TrainerPanel({
  conversation,
  refreshKey = 0,
  onClose,
}: {
  conversation: ConversationDto;
  /** Aumenta con cada evento SSE relevante: dispara un refetch en vivo. */
  refreshKey?: number;
  onClose: () => void;
}) {
  const [agent, setAgent] = useState<{ enabled: boolean; name: string } | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [size, setSize] = useState<{ chars: number; warnAt: number; warning: boolean } | null>(null);
  const [changes, setChanges] = useState<ChangeDto[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const refetch = useCallback(async () => {
    const [agentRes, aiRes, sizeRes, changesRes] = await Promise.all([
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/settings/ai").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/kb/size").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/trainer/changes?limit=30").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null, null, null]);
    if (agentRes?.profile) {
      setAgent({ enabled: Boolean(agentRes.profile.enabled), name: agentRes.profile.name });
    }
    if (aiRes) setModel(aiRes.config?.model ?? aiRes.defaults?.model ?? null);
    if (sizeRes) setSize(sizeRes);
    if (changesRes) setChanges(changesRes.changes ?? []);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch, refreshKey, conversation.id]);

  async function revert(id: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/trainer/changes/${id}/revert`, { method: "POST" }).catch(
      () => null
    );
    setBusyId(null);
    if (!res) {
      setError("Sin conexión con el servidor");
      return;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo deshacer");
    }
    void refetch();
  }

  async function clear() {
    setClearing(true);
    setError(null);
    const res = await fetch("/api/trainer/clear", { method: "POST" }).catch(() => null);
    setClearing(false);
    setConfirmClear(false);
    if (!res?.ok) setError("No se pudo vaciar la conversación");
  }

  const name = agent?.name ?? conversation.contact.name;

  return (
    <div className="flex h-full flex-col" data-testid="trainer-panel">
      <header className="sticky top-0 flex items-center gap-2 border-b bg-background px-2 py-2 md:justify-between md:px-4 md:py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Volver al chat"
          data-testid="details-back"
          className="flex h-10 w-10 items-center justify-center rounded-full text-text-2 hover:bg-accent md:hidden"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={1.8} />
        </button>
        <h3 className="text-[13px] font-[650] uppercase tracking-wide text-text-2">
          Entrenador
        </h3>
        <button
          onClick={onClose}
          aria-label="Ocultar panel"
          className="hidden rounded p-1 text-text-3 hover:bg-accent hover:text-foreground md:block"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <section className="border-b p-4">
          <div className="flex items-center gap-3">
            <TrainerAvatar />
            <div className="min-w-0">
              <p className="truncate text-sm font-[650]">{name}</p>
              <p className="text-xs text-text-3">Tu asistente de WhatsApp</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge
              variant={agent?.enabled ? "success" : "secondary"}
              data-testid="trainer-agent-status"
            >
              {agent === null ? "…" : agent.enabled ? "Encendido" : "Apagado"}
            </Badge>
            {size && (
              <Badge variant={size.warning ? "warning" : "secondary"} data-testid="trainer-kb-size">
                {size.chars.toLocaleString("es-AR")} caracteres
              </Badge>
            )}
          </div>
          {model && (
            <p className="mt-2 truncate text-[11px] text-text-3" title={model}>
              Modelo: {model}
            </p>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-text-3">
            Lo que le enseñás acá se guarda en su conocimiento y comportamiento
            al instante, y lo usa con tus clientes.
            <Link
              href="/agent"
              className="ml-1 whitespace-nowrap font-medium text-brand-text underline underline-offset-2 hover:text-brand"
            >
              Abrir Agente →
            </Link>
          </p>
        </section>

        <section className="border-b p-4" data-testid="trainer-changes">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            Cambios recientes
          </p>
          {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
          {changes === null ? (
            <p className="text-xs text-text-3">Cargando…</p>
          ) : changes.length === 0 ? (
            <p className="text-xs text-text-3">
              Todavía no le enseñaste nada. Escribile, por ejemplo: «cuando pregunten
              por precios, decí que cotizamos a medida».
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {changes.map((c) => {
                const Icon = OP_ICON[c.op];
                const reverted = c.revertedAt !== null;
                const tip = [
                  c.before ? `Antes:\n${detail(c.before)}` : null,
                  c.after ? `Después:\n${detail(c.after)}` : null,
                ]
                  .filter(Boolean)
                  .join("\n\n");
                return (
                  <li
                    key={c.id}
                    data-testid="trainer-change"
                    data-reverted={reverted ? "1" : "0"}
                    title={tip || undefined}
                    className={cn(
                      "rounded-md border px-3 py-2",
                      reverted ? "border-border/60 bg-subtle text-text-3" : "bg-background"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={1.7} />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-[13px] leading-snug",
                            reverted && "line-through decoration-text-4"
                          )}
                        >
                          {c.summary}
                        </p>
                        <p className="mt-0.5 text-[11px] text-text-3">
                          {formatTime(c.createdAt)}
                          {reverted ? " · Deshecho" : ""}
                        </p>
                      </div>
                      {!reverted && (
                        <button
                          type="button"
                          data-testid="trainer-undo"
                          disabled={busyId === c.id}
                          onClick={() => void revert(c.id)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-text-2 transition-colors hover:border-brand-soft hover:bg-brand-tint hover:text-brand-text disabled:opacity-50"
                        >
                          <Undo2 className="h-3 w-3" strokeWidth={1.8} />
                          {busyId === c.id ? "…" : "Deshacer"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            Conversación
          </p>
          <p className="mb-3 text-[11px] leading-relaxed text-text-3">
            Vaciar borra los mensajes de este hilo; lo aprendido y el historial
            de cambios se conservan.
          </p>
          {confirmClear ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                className="flex-1"
                disabled={clearing}
                onClick={() => void clear()}
              >
                {clearing ? "Vaciando…" : "Sí, vaciar"}
              </Button>
              <Button size="sm" variant="outline" disabled={clearing} onClick={() => setConfirmClear(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              data-testid="trainer-clear"
              onClick={() => setConfirmClear(true)}
            >
              Vaciar conversación
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
