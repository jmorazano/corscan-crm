"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  agentScopeStateText,
  type AgentScope,
  type AgentScopeChange,
  type AgentScopeSummary,
} from "@/lib/agent-scope";

/**
 * Modo de prueba del agente: en qué conversaciones responde. La tarjeta
 * cambia el modo; `EnableAgentDialog` pregunta lo mismo al prender el agente.
 */

async function putScope(change: AgentScopeChange): Promise<string | null> {
  const res = await fetch("/api/agent/scope", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(change),
  }).catch(() => null);
  if (res?.ok) return null;
  const body = res ? await res.json().catch(() => null) : null;
  return typeof body?.error?.message === "string" ? body.error.message : "No se pudo guardar. Probá de nuevo.";
}

function fmt(n: number): string {
  return n.toLocaleString("es-AR");
}

function ScopeOption({
  value,
  checked,
  onSelect,
  title,
  children,
}: {
  value: AgentScope;
  checked: boolean;
  onSelect: (v: AgentScope) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors",
        checked ? "border-brand bg-brand-tint" : "hover:bg-accent"
      )}
    >
      <input
        type="radio"
        name="agent-scope"
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="mt-0.5 accent-[#25D366]"
        data-testid={`agent-scope-option-${value}`}
      />
      <span className="space-y-0.5">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{children}</span>
      </span>
    </label>
  );
}

function EnableExistingCheckbox({
  count,
  checked,
  onChange,
}: {
  count: number;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  if (count === 0) return null;
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-[#25D366]"
        data-testid="agent-scope-enable-existing"
      />
      <span>
        Prender también la IA en las {fmt(count)} conversaciones que hoy la tienen apagada.
        <span className="block text-xs text-muted-foreground">
          Sin marcar, esas siguen apagadas y solo las nuevas nacen prendidas. Ojo: incluye las
          que alguien del equipo pausó a propósito.
        </span>
      </span>
    </label>
  );
}

/** Diálogo al PRENDER el agente: elegir en qué conversaciones responde. */
export function EnableAgentDialog({
  open,
  summary,
  onClose,
  onDone,
  enableWithProfile,
}: {
  open: boolean;
  summary: AgentScopeSummary;
  onClose: () => void;
  onDone: () => void;
  /** Prender el agente sin tocar el modo (PUT del perfil). */
  enableWithProfile: () => Promise<boolean>;
}) {
  const [choice, setChoice] = useState<AgentScope>(summary.scope);
  const [enableExisting, setEnableExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    let problem: string | null = null;
    if (choice === summary.scope && !(choice === "all" && enableExisting)) {
      // Mismo modo: solo se prende el agente (en modo de prueba, repetirlo
      // NO apaga las conversaciones que el equipo ya prendió).
      problem = (await enableWithProfile()) ? null : "No se pudo prender el agente. Probá de nuevo.";
    } else if (choice === "selected") {
      problem = await putScope({ scope: "selected", enableAgent: true });
    } else {
      problem = await putScope({ scope: "all", enableExisting, enableAgent: true });
    }
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    onDone();
  }

  const offNow = summary.aiOff;
  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      size="md"
      testId="enable-agent-dialog"
      title="¿En qué conversaciones responde el agente?"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={busy} onClick={() => void confirm()} data-testid="enable-agent-confirm">
            {busy ? "Prendiendo…" : "Prender el agente"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <ScopeOption
          value="all"
          checked={choice === "all"}
          onSelect={setChoice}
          title="En todas las conversaciones"
        >
          Responde a todos los que escriban, salvo en los chats donde la IA está pausada.
        </ScopeOption>
        <ScopeOption
          value="selected"
          checked={choice === "selected"}
          onSelect={setChoice}
          title="Solo en las que yo prenda (modo de prueba)"
        >
          {summary.scope === "selected"
            ? `Sigue respondiendo solo donde prendiste la IA (hoy, ${fmt(summary.aiOn)} conversaciones). Las nuevas nacen apagadas.`
            : `Se apaga la IA en las ${fmt(summary.aiOn)} conversaciones que hoy la tienen prendida y las nuevas nacen apagadas. Después la prendés chat por chat desde la Bandeja.`}
        </ScopeOption>
        {choice === "all" && (
          <EnableExistingCheckbox count={offNow} checked={enableExisting} onChange={setEnableExisting} />
        )}
        {error && (
          <p className="text-sm text-destructive" data-testid="enable-agent-error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** Tarjeta de la página Agente con el modo actual y el cambio de modo. */
export function AgentScopeSection({
  summary,
  onChanged,
}: {
  summary: AgentScopeSummary;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [enableExisting, setEnableExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const testing = summary.scope === "selected";

  async function confirm() {
    setBusy(true);
    setError(null);
    const problem = testing
      ? await putScope({ scope: "all", enableExisting })
      : await putScope({ scope: "selected" });
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setOpen(false);
    setEnableExisting(false);
    onChanged();
  }

  return (
    <Card data-testid="agent-scope-card">
      <CardHeader>
        <CardTitle>En qué conversaciones responde</CardTitle>
        <CardDescription>
          Para probar el agente con pocos contactos antes de abrirlo a todos: en modo de prueba
          responde solo en los chats donde prendas la IA.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm font-medium" data-testid="agent-scope-state">
          {agentScopeStateText(summary)}
        </p>
        {testing && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Las conversaciones nuevas llegan con la IA apagada.</li>
            <li>
              Para sumar un contacto, abrí su chat en la Bandeja y prendé la IA desde la ficha.
            </li>
            <li>
              <Link
                href="/inbox?filter=ai_on"
                className="font-medium text-brand-text underline underline-offset-2 hover:text-brand"
              >
                Ver los chats con la IA prendida
              </Link>
            </li>
          </ul>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          data-testid="agent-scope-change"
        >
          {testing ? "Responder en todas" : "Pasar a modo de prueba"}
        </Button>
      </CardContent>

      <Dialog
        open={open}
        onClose={busy ? () => {} : () => setOpen(false)}
        size="sm"
        testId="agent-scope-dialog"
        title={testing ? "Responder en todas las conversaciones" : "Pasar a modo de prueba"}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={busy} onClick={() => void confirm()} data-testid="agent-scope-confirm">
              {busy ? "Guardando…" : "Confirmar"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          {testing ? (
            <>
              <p>Las conversaciones nuevas van a nacer con la IA prendida.</p>
              <EnableExistingCheckbox
                count={summary.aiOff}
                checked={enableExisting}
                onChange={setEnableExisting}
              />
            </>
          ) : (
            <>
              <p>
                Se apaga la IA en las <strong>{fmt(summary.aiOn)}</strong> conversaciones que hoy
                la tienen prendida y las nuevas nacen apagadas.
              </p>
              <p className="text-muted-foreground">
                Después la prendés chat por chat desde la Bandeja. Para volver atrás, «Responder en
                todas».
              </p>
            </>
          )}
          {error && (
            <p className="text-destructive" data-testid="agent-scope-error">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </Card>
  );
}
