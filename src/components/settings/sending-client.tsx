"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Ajustes → Envíos y campañas (004, contrato settings-sending.md): el freno
 * del CRM sobre los contactos iniciados en 24h móviles. NO cambia el límite
 * real de Meta (tier); protege el quality rating del número.
 */

type Usage = {
  dailyInitiatedLimit: number;
  usedLast24h: number;
  available: number;
};

export function SendingSettingsClient() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [limit, setLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refetch() {
    const res = await fetch("/api/settings/sending").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as Usage;
    setUsage(data);
    setLimit(String(data.dailyInitiatedLimit));
  }

  useEffect(() => {
    void refetch();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/settings/sending", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dailyInitiatedLimit: Number(limit) }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo guardar el límite.");
      return;
    }
    const data = (await res.json()) as Usage;
    setUsage(data);
    setLimit(String(data.dailyInitiatedLimit));
    setMessage(
      "Guardado. Si había campañas pausadas por cupo y ahora hay lugar, se reanudan solas."
    );
  }

  return (
    <div className="max-w-xl space-y-5 p-6">
      <div>
        <h2 className="font-semibold">Envíos y campañas</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Máximo de contactos a los que la empresa puede INICIARLES una
          conversación (plantillas) en cualquier ventana móvil de 24 horas.
          Compartido entre campañas y envíos individuales.
        </p>
      </div>

      {usage && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Límite" value={usage.dailyInitiatedLimit} />
          <Stat label="Usado (24h)" value={usage.usedLast24h} />
          <Stat label="Disponible" value={usage.available} />
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="sending-limit">
          Límite de contactos iniciados por 24h
        </label>
        <Input
          id="sending-limit"
          type="number"
          min={1}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="w-40"
        />
        <p className="text-xs text-muted-foreground">
          Este es el freno del CRM, no el de Meta: un número sin verificación
          de negocio arranca con ~250 por día del lado del canal (sube a
          2.000+ verificando el portfolio en Meta). Poner acá más de lo que
          el canal permite solo genera fallos de envío.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
          {message}
        </p>
      )}

      <Button
        disabled={saving || !limit || Number(limit) < 1}
        onClick={() => void save()}
      >
        {saving ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
