"use client";

import { useState } from "react";
import type { AuthorizeRequest } from "@/lib/oauth-server/params";
import type { ConsentWorkspace } from "@/server/assistants/authorize";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const BLOCKED_TEXT: Record<NonNullable<ConsentWorkspace["blockedReason"]>, string> = {
  not_owner: "Solo el propietario de la empresa puede conectar asistentes.",
  disabled: "Activalo en Ajustes → Asistentes de esa empresa.",
};

/**
 * Pantalla de permiso de un asistente (040, FR-003/FR-004). Lo que dice
 * «quién pide acceso» sale del destino de retorno (`clientLabel`), no del
 * nombre que se registró: ese queda como detalle.
 */
export function ConsentForm({
  request,
  clientLabel,
  clientName,
  email,
  workspaces,
}: {
  request: AuthorizeRequest;
  clientLabel: string;
  clientName: string | null;
  email: string;
  workspaces: ConsentWorkspace[];
}) {
  const authorizable = workspaces.filter((w) => w.authorizable);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(authorizable.length === 1 ? [authorizable[0]!.id] : [])
  );
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<"allow" | "deny" | null>(null);

  async function decide(decision: "allow" | "deny") {
    setError(null);
    setSending(decision);
    const res = await fetch("/api/oauth/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: request.clientId,
        redirect_uri: request.redirectUri,
        code_challenge: request.codeChallenge,
        code_challenge_method: "S256",
        state: request.state ?? undefined,
        resource: request.resource,
        decision,
        organization_ids: [...selected],
      }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as {
      redirect?: string;
      error?: { message?: string };
    } | null;
    if (!res?.ok || !data?.redirect) {
      setSending(null);
      setError(data?.error?.message ?? "No se pudo completar. Probá de nuevo desde el asistente.");
      return;
    }
    window.location.assign(data.redirect);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conectar un asistente</CardTitle>
        <CardDescription>
          <strong className="text-foreground">{clientLabel}</strong> pide acceso a tu CRM como{" "}
          <span className="break-all">{email}</span>.
          {clientName && (
            <span className="mt-1 block text-[12px] text-text-3">Se registró como «{clientName}».</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ul className="space-y-1.5 text-sm text-text-2">
          <li>
            • Puede <strong className="text-foreground">enseñarle al agente</strong> de esas empresas (conocimiento,
            reglas, nombre, tono y saludo) cuando se lo pidas; cada cambio se deshace en el panel del Entrenador. No
            puede enviar mensajes ni cambiar ningún otro dato.
          </li>
          <li>
            • Puede leer métricas, campañas, contactos y <strong className="text-foreground">los textos de las conversaciones</strong>{" "}
            de las empresas que elijas.
          </li>
          <li>• Lo que lea queda en tu cuenta del asistente. Podés cortar el acceso cuando quieras en Ajustes → Asistentes.</li>
        </ul>

        {workspaces.length === 0 || authorizable.length === 0 ? (
          <p className="rounded-md bg-subtle px-3 py-2 text-sm text-text-2">
            No tenés empresas que puedas autorizar: solo el propietario puede conectar asistentes, y antes tiene que
            activar «Permitir asistentes externos» en Ajustes → Asistentes.
          </p>
        ) : null}

        {workspaces.length > 0 && (
          <fieldset className="min-w-0 space-y-2">
            <legend className="mb-1 text-sm font-medium">Empresas a las que das acceso</legend>
            {workspaces.map((w) => (
              <label
                key={w.id}
                className={`flex items-start gap-3 rounded-md border px-3 py-2.5 ${
                  w.authorizable ? "cursor-pointer" : "opacity-60"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 accent-primary"
                  checked={selected.has(w.id)}
                  disabled={!w.authorizable || sending !== null}
                  onChange={() => toggle(w.id)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{w.name}</span>
                  {w.blockedReason && (
                    <span className="block text-[12px] text-text-3">{BLOCKED_TEXT[w.blockedReason]}</span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => decide("deny")} disabled={sending !== null}>
            {sending === "deny" ? "Volviendo…" : "Cancelar"}
          </Button>
          <Button onClick={() => decide("allow")} disabled={sending !== null || selected.size === 0}>
            {sending === "allow" ? "Conectando…" : "Permitir"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
