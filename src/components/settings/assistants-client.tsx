"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Ajustes → Asistentes (040, FR-023): el switch «Permitir asistentes
 * externos», cómo conectar Claude, quién tiene acceso a esta empresa y qué
 * consultó. Desde la 041 el mismo switch también deja enseñarle al agente.
 * Solo propietario.
 */

type Connection = {
  id: string;
  clientLabel: string;
  clientName: string | null;
  user: { id: string; name: string; email: string };
  otherWorkspaces: number;
  status: "active" | "revoked" | "expired";
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
};

type View = {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  connectorUrl: string;
  connections: Connection[];
  trainerConversationId: string | null;
  teachingNotice: boolean;
};

type LogEntry = {
  id: string;
  at: string;
  clientLabel: string;
  user: string | null;
  tool: string;
  summary: string;
  outcome: "ok" | "denied" | "error";
  reason: string | null;
};

const REVOKED_TEXT: Record<string, string> = {
  user: "La cortó quien la conectó",
  owner: "La cortó un propietario",
  password_change: "Se cortó al cambiar la contraseña",
  refresh_reuse: "Se cortó por seguridad (renovación repetida)",
  code_reuse: "Se cortó por seguridad (código repetido)",
  idle: "Venció por 90 días sin uso",
};

const REASON_TEXT: Record<string, string> = {
  not_authorized: "empresa no autorizada",
  disabled: "acceso desactivado",
  not_owner: "ya no es propietario",
  invalid_args: "pedido inválido",
  not_found: "no encontrado",
  rate_limited: "demasiadas consultas",
  internal: "error interno",
  rejected: "todo rechazado por las protecciones",
};

/** 041: las herramientas que cambian algo se distinguen de las consultas. */
const TOOL_KIND: Record<string, string> = {
  teach_agent: "Enseñanza",
  edit_agent: "Enseñanza",
  undo_agent_change: "Deshacer",
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

export function AssistantsSettingsClient() {
  const [view, setView] = useState<View | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logCursor, setLogCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadLog = useCallback(async (cursor: string | null) => {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const res = await fetch(`/api/settings/assistants/log${qs}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { entries: LogEntry[]; nextCursor: string | null };
    setLog((prev) => (cursor ? [...prev, ...data.entries] : data.entries));
    setLogCursor(data.nextCursor);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/assistants").catch(() => null);
    if (!res?.ok) {
      setError("No se pudo cargar la configuración de asistentes.");
      return;
    }
    setView((await res.json()) as View);
    void loadLog(null);
  }, [loadLog]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle() {
    if (!view) return;
    const enabled = !view.enabled;
    if (
      enabled &&
      !window.confirm(
        "Un propietario podrá conectar un asistente (como Claude) que lea métricas, campañas, contactos y los textos de las conversaciones de esta empresa. ¿Activar?"
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/settings/assistants", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError("No se pudo guardar.");
      return;
    }
    setView((await res.json()) as View);
  }

  async function revoke(c: Connection) {
    if (
      !window.confirm(
        `¿Cortar el acceso de «${c.clientLabel}» de ${c.user.name}? ${
          c.otherWorkspaces > 0 ? "La conexión también tiene acceso a otras empresas: se corta entera. " : ""
        }Para volver a usarlo hay que conectarlo de nuevo.`
      )
    ) {
      return;
    }
    const res = await fetch(`/api/settings/assistants/connections/${encodeURIComponent(c.id)}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!res?.ok) {
      setError("No se pudo cortar el acceso.");
      return;
    }
    void load();
  }

  async function copyUrl() {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(view.connectorUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // sin permiso de portapapeles: la dirección queda seleccionable a mano
    }
  }

  if (!view) {
    return (
      <div className="max-w-2xl md:p-6">
        <p className="text-sm text-muted-foreground">{error ?? "Cargando…"}</p>
      </div>
    );
  }

  const active = view.connections.filter((c) => c.status === "active");
  const closed = view.connections.filter((c) => c.status !== "active");

  return (
    <div className="max-w-2xl space-y-6 md:p-6">
      <div>
        <h2 className="font-semibold">Asistentes (Claude)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Conectá Claude Desktop o Claude Code para preguntarle por los números y las conversaciones de esta empresa:
          «¿cuántos mensajes llegaron esta semana?», «¿cuántos respondieron la campaña?». También puede{" "}
          <strong>enseñarle al agente</strong> lo que le pidas (preguntas y respuestas, información, reglas, nombre,
          tono y saludo): cada cambio se aplica en el acto y se ve y se deshace en el{" "}
          {view.trainerConversationId ? (
            <a className="underline" href={`/inbox?c=${view.trainerConversationId}`}>
              panel del Entrenador
            </a>
          ) : (
            "panel del Entrenador"
          )}
          . No puede enviar mensajes ni cambiar ningún otro dato.
        </p>
      </div>

      {view.teachingNotice && (
        <p data-testid="teaching-notice" className="rounded-md border border-brand-soft bg-brand-tint px-4 py-3 text-sm text-brand-text">
          Desde el 27 de octubre, las conexiones de Claude que ya tenías también pueden enseñarle al agente. Si no
          querés eso, apagá el switch o revocá la conexión.
        </p>
      )}

      <div className="flex items-start justify-between gap-4 rounded-md border px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Permitir asistentes externos</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Apagado, ningún asistente obtiene datos de esta empresa ni le enseña al agente, aunque esté conectado.
            {view.updatedAt && ` Último cambio: ${fmt(view.updatedAt)}${view.updatedBy ? ` por ${view.updatedBy}` : ""}.`}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={view.enabled}
          aria-label="Permitir asistentes externos"
          disabled={saving}
          onClick={() => void toggle()}
          className={cn(
            "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors",
            view.enabled ? "bg-brand" : "bg-border-strong",
            saving && "opacity-60"
          )}
        >
          <span
            className={cn(
              "h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
              view.enabled ? "translate-x-4" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Cómo conectar</h3>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-subtle px-3 py-2 text-xs">
            {view.connectorUrl}
          </code>
          <Button variant="outline" size="sm" onClick={() => void copyUrl()}>
            {copied ? "Copiada" : "Copiar"}
          </Button>
        </div>
        <div className="space-y-2 text-sm text-text-2">
          <p>
            <strong className="text-foreground">Claude Desktop o claude.ai:</strong> Configuración → Conectores →
            «Agregar conector personalizado» → nombre «Vocero CRM» y esta dirección → «Conectar». Se abre el CRM: entrá
            con tu usuario, tildá las empresas y tocá «Permitir». En un chat nuevo, activá el conector desde el menú de
            herramientas.
          </p>
          <p>
            <strong className="text-foreground">Claude Code:</strong>{" "}
            <code className="break-all rounded bg-subtle px-1 text-xs">
              claude mcp add --transport http vocero {view.connectorUrl}
            </code>{" "}
            y después <code className="rounded bg-subtle px-1 text-xs">/mcp</code> → vocero → Authenticate.
          </p>
          {!view.enabled && (
            <p className="text-xs text-text-3">Primero activá «Permitir asistentes externos»: si no, esta empresa no aparece para tildar.</p>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Conexiones con acceso a esta empresa</h3>
        {active.length === 0 && <p className="text-sm text-muted-foreground">Ninguna por ahora.</p>}
        {active.map((c) => (
          <div key={c.id} className="flex items-start justify-between gap-3 rounded-md border px-3 py-2.5">
            <div className="min-w-0 text-sm">
              <p className="font-medium">{c.clientLabel}</p>
              <p className="text-xs text-muted-foreground">
                {c.user.name} · conectada {fmt(c.createdAt)} · último uso {fmt(c.lastUsedAt)}
                {c.otherWorkspaces > 0 &&
                  ` · también accede a ${c.otherWorkspaces} empresa${c.otherWorkspaces === 1 ? "" : "s"} más`}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void revoke(c)}>
              Revocar
            </Button>
          </div>
        ))}
        {closed.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Cerradas en los últimos 30 días ({closed.length})</summary>
            <ul className="mt-2 space-y-1">
              {closed.map((c) => (
                <li key={c.id} className="text-xs text-muted-foreground">
                  {c.clientLabel} · {c.user.name} · {REVOKED_TEXT[c.revokedReason ?? ""] ?? "Cerrada"} ({fmt(c.revokedAt)})
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Qué consultaron y qué enseñaron</h3>
        <p className="text-xs text-muted-foreground">
          Se guarda qué se pidió y cuándo (90 días), nunca lo que el CRM devolvió ni el texto enseñado.
        </p>
        {log.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hubo consultas.</p>}
        {log.length > 0 && (
          <ul className="divide-y rounded-md border">
            {log.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate">
                    {TOOL_KIND[e.tool] && (
                      <span className="mr-1.5 rounded bg-brand-tint px-1.5 py-0.5 text-[11px] font-medium text-brand-text">
                        {TOOL_KIND[e.tool]}
                      </span>
                    )}
                    {e.summary}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmt(e.at)} · {e.user ?? "—"} · {e.clientLabel}
                  </p>
                </div>
                {e.outcome !== "ok" && (
                  <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] text-destructive">
                    {e.outcome === "error" ? "Error" : "Rechazada"}
                    {e.reason ? ` · ${REASON_TEXT[e.reason] ?? e.reason}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {logCursor && (
          <Button variant="outline" size="sm" onClick={() => void loadLog(logCursor)}>
            Ver más
          </Button>
        )}
      </section>
    </div>
  );
}
