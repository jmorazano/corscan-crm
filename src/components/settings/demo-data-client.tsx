"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Result = { contacts: number; kbEntries: number };

export function DemoDataClient() {
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setRunning(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/seed/demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: true }),
    }).catch(() => null);
    setRunning(false);
    setConfirming(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo recargar la demo");
      return;
    }
    const data = (await res.json()) as Result;
    setResult(data);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Datos de demostración</CardTitle>
          <CardDescription>
            Carga un negocio de ejemplo con conversaciones, pipeline y base de
            conocimiento, para probar el CRM antes de conectar tu número real o
            para mostrárselo a alguien.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-[#ece2cf] bg-[#faf7f0] p-4 text-sm text-[#8a6d3b]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-2">
              <p className="font-medium">Recargar reemplaza datos existentes.</p>
              <ul className="list-inside list-disc space-y-1">
                <li>
                  Borra <strong>toda la base de conocimiento</strong> y{" "}
                  <strong>todas las corridas del Laboratorio</strong> de esta
                  organización, incluidas las que hayas creado vos.
                </li>
                <li>
                  Borra y vuelve a crear únicamente los contactos de demo. Tus
                  contactos y conversaciones reales no se tocan.
                </li>
              </ul>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {result && (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" />
              Demo recargada: {result.contacts} contactos y {result.kbEntries}{" "}
              entradas de conocimiento.
            </p>
          )}

          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                ¿Confirmás? Esta acción no se puede deshacer.
              </span>
              <Button
                variant="destructive"
                disabled={running}
                onClick={() => void reload()}
              >
                {running ? "Recargando…" : "Sí, recargar la demo"}
              </Button>
              <Button
                variant="outline"
                disabled={running}
                onClick={() => setConfirming(false)}
              >
                Cancelar
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              Recargar datos de demostración
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
