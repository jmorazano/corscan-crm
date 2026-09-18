"use client";

import { Bell, BellOff, BellRing, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { usePush } from "@/components/push/use-push";
import type { PushMode } from "@/lib/push-client";

const MODES: ReadonlyArray<{ id: PushMode; label: string; hint: string }> = [
  {
    id: "all",
    label: "Todos los mensajes entrantes",
    hint: "Como WhatsApp: un aviso por cada mensaje que escribe un cliente.",
  },
  {
    id: "handoff",
    label: "Solo cuando piden atención humana",
    hint: "Cuando la IA escala o está en pausa en esa conversación.",
  },
];

function deviceLabel(ua: string | null): string {
  if (!ua) return "Dispositivo";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Dispositivo";
}

/** Ajustes → Notificaciones (013, US1). */
export function NotificationsClient() {
  const { state, enable, disable, setMode, sendTest } = usePush();
  const active = state.endpoint !== null;

  return (
    <div className="max-w-2xl space-y-6" data-testid="notifications-settings">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-brand" strokeWidth={1.8} />
            Notificaciones en este dispositivo
          </CardTitle>
          <CardDescription>
            Enterate de los mensajes nuevos aunque el CRM esté cerrado. Cada
            teléfono o computadora se activa por separado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!state.ready ? (
            <p className="text-sm text-text-3">Comprobando…</p>
          ) : !state.supported ? (
            <p className="text-sm text-text-2" data-testid="push-unsupported">
              Este navegador no soporta notificaciones push. En iPhone,
              actualizá a iOS 16.4 o superior e instalá la app en la pantalla
              de inicio.
            </p>
          ) : state.needsInstall ? (
            <div
              className="rounded-md border border-[#ece2cf] bg-[#faf7f0] p-3 text-sm text-[#8a6d3b]"
              data-testid="push-needs-install"
            >
              <p className="flex items-center gap-2 font-medium">
                <Smartphone className="h-4 w-4" strokeWidth={1.8} />
                En iPhone, primero instalá la app
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Tocá el botón Compartir de Safari.</li>
                <li>Elegí «Agregar a inicio».</li>
                <li>Abrí el CRM desde el ícono nuevo y volvé a esta pantalla.</li>
              </ol>
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "flex items-center gap-3 rounded-md border px-3 py-2.5",
                  active ? "border-success/40 bg-success/10" : "bg-secondary/50"
                )}
                data-testid="push-status"
                data-active={active}
              >
                {active ? (
                  <BellRing className="h-5 w-5 text-success" strokeWidth={1.8} />
                ) : (
                  <BellOff className="h-5 w-5 text-text-3" strokeWidth={1.8} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {active
                      ? "Activas en este dispositivo"
                      : state.permission === "denied"
                        ? "Bloqueadas por el navegador"
                        : "Desactivadas en este dispositivo"}
                  </p>
                  <p className="text-xs text-text-3">
                    {active
                      ? "Vas a recibir avisos aunque el CRM esté cerrado."
                      : state.permission === "denied"
                        ? "Permitilas desde los ajustes del sitio en el navegador."
                        : "Activalas para recibir avisos de mensajes nuevos."}
                  </p>
                </div>
                {active ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={state.busy}
                    onClick={() => void disable()}
                    data-testid="push-disable"
                  >
                    Desactivar
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={state.busy || state.permission === "denied"}
                    onClick={() => void enable(state.mode ?? "all")}
                    data-testid="push-enable"
                  >
                    {state.busy ? "Activando…" : "Activar en este dispositivo"}
                  </Button>
                )}
              </div>

              <fieldset className="space-y-2" disabled={!active || state.busy}>
                <legend className="text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  Qué avisar
                </legend>
                {MODES.map((m) => (
                  <label
                    key={m.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
                      state.mode === m.id ? "border-brand bg-brand-tint" : "hover:bg-accent",
                      !active && "cursor-not-allowed opacity-60"
                    )}
                  >
                    <input
                      type="radio"
                      name="push-mode"
                      className="mt-0.5 accent-primary"
                      checked={state.mode === m.id}
                      onChange={() => void setMode(m.id)}
                      data-testid={`push-mode-${m.id}`}
                    />
                    <span>
                      <span className="block text-sm font-medium">{m.label}</span>
                      <span className="block text-xs text-text-3">{m.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!active || state.busy}
                  onClick={() => void sendTest()}
                  data-testid="push-test"
                >
                  Enviar notificación de prueba
                </Button>
                {state.notice && (
                  <p className="text-xs text-success" role="status">
                    {state.notice}
                  </p>
                )}
              </div>
            </>
          )}
          {state.error && (
            <p className="text-xs text-destructive" role="alert">
              {state.error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dispositivos activos</CardTitle>
          <CardDescription>
            Cada uno recibe según su propio modo. Un dispositivo que deja de
            existir se da de baja solo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.devices.length === 0 ? (
            <p className="text-sm text-text-3">Todavía no activaste ninguno.</p>
          ) : (
            <ul className="divide-y" data-testid="push-devices">
              {state.devices.map((d) => (
                <li key={d.endpoint} className="flex items-center gap-3 py-2 text-sm">
                  <Smartphone className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.8} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {deviceLabel(d.userAgent)}
                      {d.endpoint === state.endpoint && (
                        <span className="ml-2 rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-semibold text-brand-text">
                          este
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-text-3">
                      {d.mode === "all" ? "Todos los mensajes" : "Solo atención humana"} ·
                      activado el {new Date(d.createdAt).toLocaleDateString("es-AR")}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
