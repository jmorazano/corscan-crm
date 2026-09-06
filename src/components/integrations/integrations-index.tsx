"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Índice de integraciones (FR-001): una tarjeta por integración soportada
 * con su estado. Hoy: Google Calendar.
 */

type IntegrationItem = {
  key: string;
  name: string;
  available: boolean;
  connected: boolean;
  status: "connected" | "reconnect_required" | null;
  accountEmail: string | null;
};

const HREF: Record<string, string> = { google_calendar: "/integrations/google-calendar" };

export function IntegrationsIndex() {
  const [items, setItems] = useState<IntegrationItem[] | null>(null);

  useEffect(() => {
    fetch("/api/integrations")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { integrations: IntegrationItem[] } | null) => setItems(d?.integrations ?? []))
      .catch(() => setItems([]));
  }, []);

  if (!items) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
      {items.map((it) => (
        <Card key={it.key} data-testid={`integration-${it.key}`}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-brand" strokeWidth={1.7} />
                {it.name}
              </CardTitle>
              <StatusBadge item={it} />
            </div>
            <CardDescription>
              {it.key === "google_calendar"
                ? "El agente consulta disponibilidad y agenda turnos en el calendario del negocio."
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3 px-5 pb-5">
            <span className="truncate text-xs text-muted-foreground">
              {it.connected
                ? it.accountEmail ?? "Cuenta conectada"
                : it.available
                  ? "No conectada"
                  : "No habilitada por el operador de la instancia"}
            </span>
            <Link href={HREF[it.key] ?? "/integrations"}>
              <Button size="sm" variant={it.connected ? "outline" : "default"}>
                {it.connected ? "Administrar" : "Abrir"}
              </Button>
            </Link>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function StatusBadge({ item }: { item: IntegrationItem }) {
  if (!item.available) return <Badge variant="secondary">No disponible</Badge>;
  if (!item.connected) return <Badge variant="secondary">No conectada</Badge>;
  if (item.status === "reconnect_required") return <Badge variant="warning">Requiere reconexión</Badge>;
  return <Badge variant="success">Conectada</Badge>;
}
