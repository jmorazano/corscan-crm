"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ATTENTION_MAX_MINUTES, ATTENTION_MIN_MINUTES } from "@/lib/team-attention";

type Settings = { alertEnabled: boolean; alertMinutes: number; ownerHasPush: boolean };

/**
 * 048: «Aviso cuando un cliente espera» — push al propietario cuando un
 * cliente derivado (o con la IA apagada) lleva N minutos sin respuesta del
 * equipo. Apagado por defecto. Los minutos también definen «tarde» en
 * Métricas → Equipo.
 */
export function AttentionAlertCard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [minutes, setMinutes] = useState("15");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings/attention")
      .then((r) => (r.ok ? (r.json() as Promise<Settings>) : Promise.reject(r.status)))
      .then((s) => {
        setSettings(s);
        setMinutes(String(s.alertMinutes));
      })
      .catch(() => setError("No se pudo cargar el aviso."));
  }, []);

  async function save(next: { alertEnabled: boolean; alertMinutes: number }) {
    const n = next.alertMinutes;
    if (!Number.isInteger(n) || n < ATTENTION_MIN_MINUTES || n > ATTENTION_MAX_MINUTES) {
      setError(`Elegí entre ${ATTENTION_MIN_MINUTES} y ${ATTENTION_MAX_MINUTES} minutos.`);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/settings/attention", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError("No se pudo guardar. Probá de nuevo.");
      return;
    }
    const s = (await res.json()) as Settings;
    setSettings(s);
    setMinutes(String(s.alertMinutes));
    setSaved(true);
  }

  const enabled = settings?.alertEnabled ?? false;
  const parsedMinutes = Number(minutes);

  return (
    <Card data-testid="attention-alert-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Aviso cuando un cliente espera</CardTitle>
            <CardDescription>
              Te llega una notificación cuando un cliente que necesita a una persona (el agente lo derivó o la
              IA está apagada) lleva estos minutos sin que nadie del equipo le responda. Una sola vez por
              espera.
            </CardDescription>
          </div>
          <Switch
            checked={enabled}
            aria-label="Aviso cuando un cliente espera"
            data-testid="attention-alert-switch"
            disabled={!settings || saving}
            onClick={() =>
              void save({
                alertEnabled: !enabled,
                alertMinutes: Number.isFinite(parsedMinutes) ? parsedMinutes : 15,
              })
            }
            className="mt-1"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="attention-minutes">Minutos sin respuesta</Label>
            <Input
              id="attention-minutes"
              data-testid="attention-alert-minutes"
              type="number"
              inputMode="numeric"
              min={ATTENTION_MIN_MINUTES}
              max={ATTENTION_MAX_MINUTES}
              className="w-28"
              value={minutes}
              onChange={(e) => {
                setMinutes(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <Button
            variant="outline"
            data-testid="attention-alert-save"
            disabled={!settings || saving || parsedMinutes === settings.alertMinutes}
            onClick={() => void save({ alertEnabled: enabled, alertMinutes: parsedMinutes })}
          >
            {saving ? "Guardando…" : "Guardar"}
          </Button>
          {saved && <span className="pb-2 text-xs text-success">Guardado</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          Llega a los dispositivos de los propietarios, a cualquier hora. En Métricas → Equipo, una espera
          respondida después de estos minutos cuenta como «tarde».
        </p>
        {settings && !settings.ownerHasPush && (
          <p
            className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs"
            data-testid="attention-alert-no-push"
          >
            <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={1.8} aria-hidden />
            <span>
              No tenés notificaciones activas en ningún dispositivo: el aviso no te va a llegar.{" "}
              <Link href="/settings/notifications" className="font-medium underline underline-offset-2">
                Activarlas
              </Link>
            </span>
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
