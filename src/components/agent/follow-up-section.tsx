"use client";

import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Settings = {
  enabled: boolean;
  timezone: string;
  startHour: number;
  endHour: number;
  text1: string | null;
  text2: string | null;
  defaultText1: string;
  defaultText2: string;
  namePlaceholder: string;
};

type Summary = {
  days: number;
  sent: number;
  replied: number;
  failed: number;
  unmarked: number;
  skipped: { reason: string; label: string; count: number }[];
};

/**
 * 042: «Seguimiento automático». Hasta dos recordatorios dentro de la ventana
 * de 24 h cuando el cliente deja de contestar, solo si el agente marcó que
 * esperaba respuesta. Apagado por defecto.
 */
export function FollowUpSection() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [draft, setDraft] = useState({ timezone: "", startHour: "9", endHour: "21", text1: "", text2: "" });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/agent/follow-up");
    if (!res.ok) return;
    const data = (await res.json()) as { settings: Settings; summary: Summary };
    setSettings(data.settings);
    setSummary(data.summary);
    setDraft({
      timezone: data.settings.timezone,
      startHour: String(data.settings.startHour),
      endHour: String(data.settings.endHour),
      text1: data.settings.text1 ?? "",
      text2: data.settings.text2 ?? "",
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Record<string, unknown>) {
    setError(null);
    setSaved(false);
    const res = await fetch("/api/agent/follow-up", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "No se pudo guardar");
      return;
    }
    const data = (await res.json()) as { settings: Settings };
    setSettings(data.settings);
    setSaved(true);
  }

  if (!settings) return null;
  const enabled = settings.enabled;
  const startHour = Number(draft.startHour);
  const endHour = Number(draft.endHour);
  const hoursInvalid =
    !Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || endHour > 24 || startHour >= endHour;

  return (
    <Card data-testid="follow-up-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>Seguimiento automático</CardTitle>
            <CardDescription>
              Si el cliente deja de contestar, el agente le manda hasta dos recordatorios dentro de las 24 h
              (a las 2 h y a las 20 h), solo cuando quedó esperando una respuesta.
            </CardDescription>
          </div>
          <button
            role="switch"
            aria-checked={enabled}
            aria-label="Seguimiento automático"
            data-testid="follow-up-switch"
            onClick={() => void save({ enabled: !enabled })}
            className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors ${
              enabled ? "bg-primary" : "bg-secondary"
            }`}
          >
            <span
              className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Nunca a quien reservó o compró (etapa ganada), a un lead perdido ni a quien se dio de baja.</li>
          <li>Si alguien del equipo escribió en el chat, el agente no se mete.</li>
          <li>
            Si el cliente pide que no le escriban, el agente lo da de baja: no recibe más seguimientos ni
            campañas (si vuelve a escribir, se le responde).
          </li>
          <li>Solo WhatsApp y solo dentro de la ventana de 24 h (texto libre, sin plantilla).</li>
        </ul>
        <p className="text-xs font-medium" data-testid="follow-up-state">
          {enabled ? "Activado." : "Desactivado: el agente no manda recordatorios."}
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="follow-up-start">Desde (hora)</Label>
            <Input
              id="follow-up-start"
              inputMode="numeric"
              className="w-20"
              value={draft.startHour}
              data-testid="follow-up-start"
              onChange={(e) => setDraft({ ...draft, startHour: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="follow-up-end">Hasta (hora)</Label>
            <Input
              id="follow-up-end"
              inputMode="numeric"
              className="w-20"
              value={draft.endHour}
              data-testid="follow-up-end"
              onChange={(e) => setDraft({ ...draft, endHour: e.target.value })}
            />
          </div>
          <div className="min-w-[12rem] flex-1 space-y-1.5">
            <Label htmlFor="follow-up-tz">Zona horaria</Label>
            <Input
              id="follow-up-tz"
              value={draft.timezone}
              data-testid="follow-up-timezone"
              onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
            />
          </div>
        </div>
        {hoursInvalid && (
          <p className="text-xs text-destructive">Las horas van de 0 a 24 y el inicio tiene que ser antes del fin.</p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="follow-up-text1">Texto de respaldo del recordatorio 1</Label>
          <Textarea
            id="follow-up-text1"
            rows={3}
            placeholder={settings.defaultText1}
            value={draft.text1}
            data-testid="follow-up-text1"
            onChange={(e) => setDraft({ ...draft, text1: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="follow-up-text2">Texto de respaldo del recordatorio 2</Label>
          <Textarea
            id="follow-up-text2"
            rows={3}
            placeholder={settings.defaultText2}
            value={draft.text2}
            data-testid="follow-up-text2"
            onChange={(e) => setDraft({ ...draft, text2: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            El agente escribe cada recordatorio según la charla; estos textos salen si el proveedor de IA
            falla, y le sirven de ejemplo. {settings.namePlaceholder} se reemplaza por el primer nombre del
            cliente (o queda «¡Hola!»). Vacío = el texto de ejemplo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={hoursInvalid || !draft.timezone.trim()}
            data-testid="follow-up-save"
            onClick={() =>
              void save({
                timezone: draft.timezone.trim(),
                startHour,
                endHour,
                text1: draft.text1,
                text2: draft.text2,
              })
            }
          >
            Guardar seguimiento
          </Button>
          {saved && <span className="text-xs text-muted-foreground">Guardado.</span>}
          {error && (
            <span className="text-xs text-destructive" data-testid="follow-up-error">
              {error}
            </span>
          )}
        </div>

        {summary && (
          <div className="space-y-2 rounded-md border border-border p-3" data-testid="follow-up-summary">
            <p className="text-xs font-medium">Últimos {summary.days} días</p>
            <p className="text-sm">
              <strong>{summary.sent}</strong> enviados · <strong>{summary.replied}</strong> contestaron
              {summary.failed > 0 ? (
                <>
                  {" "}
                  · <strong>{summary.failed}</strong> no salieron
                </>
              ) : null}
            </p>
            {summary.skipped.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {summary.skipped.slice(0, 6).map((s) => (
                  <li key={s.reason}>
                    {s.count} omitidos: {s.label}
                  </li>
                ))}
              </ul>
            )}
            {summary.unmarked > 0 && (
              <p className="text-xs text-warning" data-testid="follow-up-unmarked">
                {summary.unmarked} respuestas del agente quedaron sin marcar si esperaba respuesta: esas charlas
                no reciben seguimiento.
              </p>
            )}
            <a
              href="/api/agent/follow-up/export"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-text underline underline-offset-2 hover:text-brand"
              data-testid="follow-up-export"
            >
              <Download className="h-3.5 w-3.5" aria-hidden /> Descargar registro (CSV, 90 días)
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
