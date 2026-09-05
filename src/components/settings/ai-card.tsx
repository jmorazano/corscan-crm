"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Card "Inteligencia artificial" (US3/FR-008..FR-010): la config de IA es de
 * ESTA empresa — token del proveedor (solo se muestran los últimos 4) y
 * modelos opcionales con los defaults de producto como placeholder. Sin
 * config, el agente y el Laboratorio están apagados con guía para activarlos.
 */

type AiSettingsResponse = {
  config: {
    configured: boolean;
    tokenLast4: string;
    model: string | null;
    judgeModel: string | null;
  } | null;
  defaults: { model: string; judgeModel: string };
};

export function AiCard() {
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<AiSettingsResponse["config"]>(null);
  const [defaults, setDefaults] = useState({ model: "", judgeModel: "" });
  const [token, setToken] = useState("");
  const [model, setModel] = useState("");
  const [judgeModel, setJudgeModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/ai").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as AiSettingsResponse;
    setConfig(data.config);
    setDefaults(data.defaults);
    setModel(data.config?.model ?? "");
    setJudgeModel(data.config?.judgeModel ?? "");
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/settings/ai", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        model: model.trim() || undefined,
        judgeModel: judgeModel.trim() || undefined,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo guardar la configuración");
      return;
    }
    setToken("");
    setNotice("Configuración guardada. El agente ya puede usar la IA de tu empresa.");
    void refetch();
  }

  async function remove() {
    if (
      !window.confirm(
        "¿Borrar la configuración de IA? El agente y el Laboratorio de tu empresa quedarán apagados hasta que pegues un token de nuevo."
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/settings/ai", { method: "DELETE" }).catch(
      () => null
    );
    setDeleting(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo borrar la configuración");
      return;
    }
    setNotice("Configuración borrada: el agente quedó apagado.");
    void refetch();
  }

  const configured = Boolean(config?.configured);

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Inteligencia artificial</CardTitle>
            {loaded && (
              <Badge variant={configured ? "default" : "secondary"}>
                {configured ? "Agente activo" : "Agente apagado"}
              </Badge>
            )}
          </div>
          <CardDescription>
            El consumo de IA corre contra el token de TU empresa: cada negocio
            monitorea su gasto en el panel de su proveedor. Se guarda cifrado y
            solo se muestran sus últimos 4 caracteres.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loaded && !configured && (
            <div className="rounded-lg border border-brand-soft bg-brand-tint p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                Tu empresa aún no tiene IA configurada
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Sin token, el{" "}
                <Link href="/agent" className="underline underline-offset-2">
                  agente
                </Link>{" "}
                y el Laboratorio están apagados; la bandeja manual funciona
                normal. Crea tu key en openrouter.ai → Keys (o cualquier
                proveedor compatible) y pégala aquí para activarlos.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ai-token">Token del proveedor</Label>
            <Input
              id="ai-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={
                configured
                  ? `Guardado (····${config!.tokenLast4}) — pega uno nuevo para rotarlo`
                  : "sk-or-..."
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ai-model">Modelo del agente (opcional)</Label>
              <Input
                id="ai-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={defaults.model || "default de producto"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-judge-model">
                Modelo del juez del Laboratorio (opcional)
              </Label>
              <Input
                id="ai-judge-model"
                value={judgeModel}
                onChange={(e) => setJudgeModel(e.target.value)}
                placeholder={defaults.judgeModel || "default de producto"}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Vacíos usan los defaults de producto que ves de guía. El token no
            se valida contra el proveedor al guardar: el primer turno del
            agente lo prueba en la práctica y, si es inválido, la conversación
            escala a un humano sin colgarse.
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && (
            <div className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3 text-sm">
              <p className="text-[#3f6b52]">{notice}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              disabled={saving || !token.trim()}
              onClick={() => void save()}
            >
              {saving ? "Guardando…" : configured ? "Rotar token" : "Guardar y activar"}
            </Button>
            {configured && (
              <Button
                variant="outline"
                disabled={deleting}
                onClick={() => void remove()}
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? "Borrando…" : "Borrar configuración"}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Solo el propietario de la empresa puede guardar o borrar esta
            configuración.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
