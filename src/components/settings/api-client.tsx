"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TemplateDto } from "@/lib/types";
import { curlSendExample, publicVariables } from "@/lib/public-templates";

/**
 * Ajustes → API (014, FR-001/FR-012): claves de la empresa (el secreto se
 * ve UNA vez), estado del canal y cupo, y la guía de integración con
 * ejemplos `curl` armados con las plantillas aprobadas reales.
 */

type KeyDto = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type Connection = {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
} | null;

type Usage = { dailyInitiatedLimit: number; usedLast24h: number; available: number };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // sin permiso de portapapeles: cae al textarea temporal
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
      {done ? "Copiado" : label}
    </Button>
  );
}

function Code({ children, testId }: { children: string; testId?: string }) {
  return (
    <pre
      data-testid={testId}
      className="overflow-x-auto rounded-md border bg-secondary/60 px-3 py-2 text-[12px] leading-relaxed"
    >
      <code>{children}</code>
    </pre>
  );
}

export function ApiSettingsClient({ baseUrl }: { baseUrl: string }) {
  const [keys, setKeys] = useState<KeyDto[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [connection, setConnection] = useState<Connection>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<KeyDto | null>(null);

  const refetch = useCallback(async () => {
    const [k, w, s, t] = await Promise.all([
      fetch("/api/settings/api-keys").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/settings/whatsapp").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/settings/sending").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/templates").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (k) {
      setKeys((k as { keys: KeyDto[] }).keys);
      setCanManage(Boolean((k as { canManage: boolean }).canManage));
    }
    setConnection((w as { connection: Connection } | null)?.connection ?? null);
    setUsage((s as Usage | null) ?? null);
    setTemplates((t as { templates: TemplateDto[] } | null)?.templates ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function create() {
    setCreating(true);
    setError(null);
    const res = await fetch("/api/settings/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    }).catch(() => null);
    setCreating(false);
    const data = (await res?.json().catch(() => null)) as
      | { key: KeyDto; secret: string }
      | { error?: { message?: string } }
      | null;
    if (!res?.ok || !data || !("secret" in data)) {
      setError(
        (data as { error?: { message?: string } } | null)?.error?.message ??
          "No se pudo crear la clave."
      );
      return;
    }
    setSecret({ name: data.key.name, value: data.secret });
    setName("");
    void refetch();
  }

  async function revoke(key: KeyDto) {
    setError(null);
    const res = await fetch(`/api/settings/api-keys/${key.id}`, { method: "DELETE" }).catch(
      () => null
    );
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo revocar la clave.");
      return;
    }
    if (secret && keys.find((k) => k.id === key.id)?.name === secret.name) setSecret(null);
    void refetch();
  }

  const approved = templates.filter((t) => t.status === "approved");
  const active = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);
  const exampleKey = secret?.value ?? (active[0] ? `${active[0].prefix}…` : "vk_TU_CLAVE");

  return (
    <div className="max-w-3xl space-y-6 md:p-6" data-testid="api-settings">
      <div>
        <h2 className="font-semibold">API de envíos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Para que el sistema de tu empresa (reservas, turnos, pedidos…) envíe
          notificaciones de WhatsApp a tus clientes a través del CRM, con tus
          plantillas aprobadas. Cada mensaje queda en la bandeja como cualquier
          otro y las respuestas las atiende tu equipo o el agente.
        </p>
      </div>

      {/* Estado rápido (FR-012) */}
      <div className="grid grid-cols-1 gap-2 text-center sm:grid-cols-3">
        <Stat
          label="Canal de WhatsApp"
          value={
            !loaded
              ? "…"
              : !connection
                ? "Sin conectar"
                : connection.status === "reconnect_required"
                  ? "Reconectar"
                  : (connection.displayPhoneNumber ?? "Conectado")
          }
          tone={!loaded ? undefined : connection?.status === "connected" ? "ok" : "warn"}
        />
        <Stat
          label="Cupo disponible (24h)"
          value={usage ? `${usage.available} / ${usage.dailyInitiatedLimit}` : "…"}
        />
        <Stat label="Plantillas aprobadas" value={loaded ? String(approved.length) : "…"} />
      </div>

      {/* Claves (FR-001/FR-002) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-brand" strokeWidth={1.8} />
            <CardTitle>Claves de API</CardTitle>
          </div>
          <CardDescription>
            Una clave por sistema que se integra. La clave completa se muestra
            una sola vez al crearla: guardala en un lugar seguro. Podés
            revocarla cuando quieras.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {secret && (
            <div
              data-testid="api-key-secret-box"
              className="space-y-2 rounded-md border border-brand-soft bg-brand-tint px-3 py-3"
            >
              <p className="text-sm font-medium">
                Clave «{secret.name}» creada. Copiala ahora: no se vuelve a mostrar.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code
                  data-testid="api-key-secret"
                  className="flex-1 select-all break-all rounded border bg-background px-2 py-1.5 text-[12px]"
                >
                  {secret.value}
                </code>
                <CopyButton text={secret.value} label="Copiar clave" />
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSecret(null)}>
                Ya la guardé
              </Button>
            </div>
          )}

          {canManage && (
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) void create();
              }}
            >
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="api-key-name">Nombre de la clave</Label>
                <Input
                  id="api-key-name"
                  data-testid="api-key-name"
                  placeholder="Sistema de reservas"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={creating || !name.trim()} data-testid="api-key-create">
                {creating ? "Creando…" : "Nueva clave"}
              </Button>
            </form>
          )}
          {!canManage && loaded && (
            <p className="text-xs text-muted-foreground">
              Solo el propietario de la empresa puede crear o revocar claves.
            </p>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {loaded && keys.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="api-keys-empty">
              Todavía no hay claves.
            </p>
          )}
          {keys.length > 0 && (
            <ul className="divide-y rounded-md border" data-testid="api-keys-list">
              {[...active, ...revoked].map((k) => (
                <li
                  key={k.id}
                  data-testid="api-key-row"
                  data-key-id={k.id}
                  className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{k.name}</span>
                      {k.revokedAt ? (
                        <Badge variant="destructive">Revocada</Badge>
                      ) : (
                        <Badge variant="success">Activa</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <code>{k.prefix}…</code> · creada {fmtDate(k.createdAt)} ·{" "}
                      {k.lastUsedAt ? `último uso ${fmtDate(k.lastUsedAt)}` : "nunca usada"}
                    </p>
                  </div>
                  {canManage && !k.revokedAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="api-key-revoke"
                      onClick={() => setRevoking(k)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Revocar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Guía (FR-012) */}
      <Card>
        <CardHeader>
          <CardTitle>Cómo integrar</CardTitle>
          <CardDescription>
            Tres llamadas HTTP. Todas llevan el header{" "}
            <code>Authorization: Bearer &lt;clave&gt;</code>. Las respuestas de
            error son <code>{"{ error: { code, message } }"}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 text-sm">
          <section className="space-y-2">
            <h3 className="font-medium">1. Plantillas disponibles</h3>
            <p className="text-muted-foreground">
              Devuelve las plantillas aprobadas por Meta y sus variables:{" "}
              <code>provided_by: &quot;crm&quot;</code> las completa el CRM (nombre del
              contacto, nombre de la empresa); <code>&quot;caller&quot;</code> las mandás
              vos en <code>params</code>.
            </p>
            <Code>{`curl ${baseUrl}/api/v1/templates \\\n  -H "Authorization: Bearer ${exampleKey}"`}</Code>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">2. Enviar una notificación</h3>
            <p className="text-muted-foreground">
              El CRM normaliza el teléfono, crea el contacto y la conversación si no
              existen, y envía la plantilla. Mandá siempre un{" "}
              <code>Idempotency-Key</code> único por evento (por ejemplo{" "}
              <code>reserva-123:recordatorio</code>): si reintentás por un timeout, no
              se envía dos veces.
            </p>
            {approved.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-2 text-muted-foreground">
                Todavía no hay plantillas aprobadas. Creá una por cada evento
                (reserva confirmada, recordatorio, instrucciones de llegada…) en
                Ajustes → Plantillas, con categoría UTILITY y el origen de cada
                variable; cuando Meta la apruebe, el ejemplo aparece acá.
              </p>
            ) : (
              <div className="space-y-4">
                {approved.map((t) => {
                  const vars = publicVariables(t);
                  const curl = curlSendExample({ baseUrl, template: t, key: exampleKey });
                  return (
                    <div key={t.id} className="space-y-1.5" data-testid={`api-template-${t.name}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">
                          <code>{t.name}</code>{" "}
                          <span className="text-xs text-muted-foreground">
                            {t.language} · {t.category}
                          </span>
                        </p>
                        <CopyButton text={curl} label="Copiar curl" />
                      </div>
                      <p className="whitespace-pre-wrap rounded-md border-l-2 border-brand-soft pl-2 text-muted-foreground">
                        {t.body}
                      </p>
                      {vars.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5">
                          {vars.map((v) => (
                            <li key={v.index}>
                              <Badge variant={v.provided_by === "caller" ? "warning" : "secondary"}>
                                {`{{${v.index}}}`} · {v.label}
                                {v.provided_by === "caller" ? " · la mandás vos" : " · la completa el CRM"}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                      <Code testId={`api-curl-${t.name}`}>{curl}</Code>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-muted-foreground">
              Respuesta <code>201</code>:{" "}
              <code>
                {'{ "message": { "id", "status": "pending" }, "contact": { "id", "phone", "created" }, "conversation": { "id", "url" } }'}
              </code>
              . <code>pending</code> significa aceptado por WhatsApp; la entrega llega después.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">3. Estado de un mensaje</h3>
            <Code>{`curl ${baseUrl}/api/v1/messages/msg_XXXX \\\n  -H "Authorization: Bearer ${exampleKey}"`}</Code>
            <p className="text-muted-foreground">
              <code>status</code>: <code>pending</code> → <code>sent</code> →{" "}
              <code>delivered</code> → <code>read</code>, o <code>failed</code> con{" "}
              <code>error</code> explicado.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">Reglas de WhatsApp que conviene saber</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>
                Solo se envían plantillas <strong>aprobadas</strong>; se identifican por
                nombre (y <code>language</code> si el nombre existe en varios idiomas).
              </li>
              <li>
                Para avisos de reserva usá categoría <strong>UTILITY</strong>: es más
                barata y no tiene el límite por destinatario de las de marketing.
              </li>
              <li>
                Los valores de <code>params</code> no admiten saltos de línea, tabulaciones
                ni más de 4 espacios seguidos (máximo 500 caracteres).
              </li>
              <li>
                Hay un cupo de contactos iniciados por 24 h compartido con las campañas
                (Ajustes → Envíos y campañas): al agotarse responde <code>429</code> con{" "}
                <code>retryInSeconds</code>.
              </li>
              <li>
                Un contacto que pidió la baja (<em>BAJA</em>/<em>STOP</em>) responde{" "}
                <code>409 opted_out</code>: no se le envía.
              </li>
              <li>
                Si el cliente contesta solo «gracias» u «ok», el agente de IA no responde;
                si pregunta o pide algo, lo atiende con normalidad.
              </li>
              <li>Máximo 60 llamadas por minuto por clave.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="font-medium">Errores</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">HTTP</th>
                    <th className="py-1 pr-3">code</th>
                    <th className="py-1">Cuándo</th>
                  </tr>
                </thead>
                <tbody className="[&_td]:py-1 [&_td]:pr-3 [&_tr]:border-t">
                  <tr><td>401</td><td><code>invalid_api_key</code></td><td>clave ausente, inválida o revocada</td></tr>
                  <tr><td>422</td><td><code>invalid_phone</code></td><td>teléfono no válido</td></tr>
                  <tr><td>404</td><td><code>template_not_found</code></td><td>no existe la plantilla</td></tr>
                  <tr><td>422</td><td><code>template_not_approved</code></td><td>Meta aún no la aprobó</td></tr>
                  <tr><td>422</td><td><code>missing_params</code> / <code>unknown_params</code> / <code>invalid_param</code></td><td>problema con <code>params</code></td></tr>
                  <tr><td>422</td><td><code>idempotency_mismatch</code></td><td>misma Idempotency-Key con otro cuerpo</td></tr>
                  <tr><td>409</td><td><code>opted_out</code></td><td>el contacto pidió la baja</td></tr>
                  <tr><td>409</td><td><code>not_connected</code> / <code>reconnect_required</code></td><td>el número de WhatsApp no está operativo</td></tr>
                  <tr><td>429</td><td><code>quota_exceeded</code> / <code>rate_limited</code></td><td>cupo agotado / demasiadas llamadas</td></tr>
                  <tr><td>503</td><td><code>meta_unavailable</code></td><td>WhatsApp no disponible: reintentá con la misma Idempotency-Key</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Referencia completa en <code>docs/api/v1.md</code> del repositorio.
            </p>
          </section>
        </CardContent>
      </Card>

      {revoking && (
        <Dialog
          open
          onClose={() => setRevoking(null)}
          title={`Revocar «${revoking.name}»`}
          testId="confirm-dialog"
          footer={
            <>
              <Button variant="ghost" onClick={() => setRevoking(null)} data-testid="confirm-no">
                Volver
              </Button>
              <Button
                variant="destructive"
                data-testid="confirm-yes"
                onClick={async () => {
                  const k = revoking;
                  setRevoking(null);
                  await revoke(k);
                }}
              >
                Revocar
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            El sistema que use esta clave dejará de poder enviar de inmediato. Los
            mensajes ya enviados no se tocan.
          </p>
        </Dialog>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p
        className={
          "truncate text-base font-semibold " +
          (tone === "ok" ? "text-[#3f6b52]" : tone === "warn" ? "text-[#8a6d3b]" : "")
        }
        title={value}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
