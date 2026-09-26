"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Instagram, Plug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Índice de integraciones (FR-001): una tarjeta por integración soportada
 * con su estado. Hoy: Instagram Direct (023), Google Calendar y el conector
 * MCP (016).
 */

type IntegrationItem = {
  key: string;
  name: string;
  available: boolean;
  connected: boolean;
  status: "connected" | "reconnect_required" | string | null;
  accountEmail: string | null;
  /** 016: host del servidor MCP (la URL completa jamás llega al cliente). */
  endpointHost?: string | null;
};

/**
 * Presentación por integración. Antes esto eran tres condicionales sueltos
 * —un `HREF` con una sola clave, el ícono de calendario cableado y una
 * descripción con `key === "google_calendar" ? … : ""`— y sumar la segunda
 * integración dejó el botón «Administrar» apuntando a `/integrations`, o sea
 * a la página en la que ya estabas. Una entrada acá y la tarjeta queda bien.
 */
const META: Record<
  string,
  { href: string; icon: typeof CalendarDays; description: string }
> = {
  google_calendar: {
    href: "/integrations/google-calendar",
    icon: CalendarDays,
    description:
      "El agente consulta disponibilidad y agenda turnos en el calendario del negocio.",
  },
  instagram: {
    href: "/integrations/instagram",
    icon: Instagram,
    description:
      "Los mensajes directos de la cuenta de Instagram del negocio entran a la Bandeja y el agente los atiende.",
  },
  mcp: {
    href: "/integrations/mcp",
    icon: Plug,
    description:
      "El agente consulta el sistema del negocio y responde con datos reales: disponibilidad, precios y enlaces.",
  },
};

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
      {items.map((it) => {
        const meta = META[it.key];
        const Icon = meta?.icon ?? Plug;
        return (
        <Card key={it.key} data-testid={`integration-${it.key}`}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.7} />
                {it.name}
              </CardTitle>
              <StatusBadge item={it} />
            </div>
            <CardDescription>{meta?.description ?? ""}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3 px-5 pb-5">
            <span className="truncate text-xs text-muted-foreground">
              {it.connected
                ? /* cuenta de Google, o host del servidor MCP: cada
                     integración se identifica con lo suyo, no con un texto
                     genérico. */
                  it.accountEmail ?? it.endpointHost ?? "Conectada"
                : it.available
                  ? "No conectada"
                  : "No habilitada por el operador de la instancia"}
            </span>
            <Link href={meta?.href ?? "/integrations"}>
              <Button size="sm" variant={it.connected ? "outline" : "default"}>
                {it.connected ? "Administrar" : "Abrir"}
              </Button>
            </Link>
          </CardContent>
        </Card>
        );
      })}
    </div>
  );
}

function StatusBadge({ item }: { item: IntegrationItem }) {
  if (!item.available) return <Badge variant="secondary">No disponible</Badge>;
  if (!item.connected) return <Badge variant="secondary">No conectada</Badge>;
  if (item.status === "reconnect_required") return <Badge variant="warning">Requiere reconexión</Badge>;
  return <Badge variant="success">Conectada</Badge>;
}
