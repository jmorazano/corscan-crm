"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { StageDto } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type StaleSettings = {
  staleLostDays: number | null;
  options: number[];
  preview: Record<string, number>;
  canEdit: boolean;
};

/** Gestión de etapas: renombrar, reordenar, agregar, eliminar (con reasignación). */
export function StageManager({
  open,
  stages,
  onClose,
  onChanged,
}: {
  open: boolean;
  stages: StageDto[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<StageDto | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 044: «pasar a perdido tras N días sin respuesta».
  const [stale, setStale] = useState<StaleSettings | null>(null);
  const [savingStale, setSavingStale] = useState(false);
  const [staleNote, setStaleNote] = useState<string | null>(null);

  const loadStale = useCallback(async () => {
    const res = await fetch("/api/pipeline/settings").catch(() => null);
    if (res?.ok) setStale((await res.json()) as StaleSettings);
  }, []);

  useEffect(() => {
    if (open) {
      setStaleNote(null);
      void loadStale();
    }
  }, [open, loadStale]);

  async function saveStale(value: string) {
    const days = value ? Number(value) : null;
    setSavingStale(true);
    setStaleNote(null);
    const res = await fetch("/api/pipeline/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ staleLostDays: days }),
    }).catch(() => null);
    setSavingStale(false);
    if (!res?.ok) {
      setStaleNote("No se pudo guardar. Probá de nuevo.");
      return;
    }
    const data = (await res.json()) as { moved?: number };
    setStaleNote(
      days
        ? data.moved
          ? `Listo: ${data.moved} ${data.moved === 1 ? "lead pasó" : "leads pasaron"} a Perdido.`
          : "Listo: se aplica sola a partir de ahora."
        : "Apagada: nadie pasa a Perdido por días sin respuesta."
    );
    await loadStale();
    onChanged();
  }

  async function rename(stage: StageDto, name: string) {
    if (!name.trim() || name === stage.name) return;
    await fetch(`/api/pipeline/stages/${stage.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    }).catch(() => null);
    onChanged();
  }

  async function move(stage: StageDto, dir: -1 | 1) {
    const sorted = [...stages].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((s) => s.id === stage.id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    await Promise.all([
      fetch(`/api/pipeline/stages/${stage.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position: swap.position }),
      }),
      fetch(`/api/pipeline/stages/${swap.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position: stage.position }),
      }),
    ]).catch(() => null);
    onChanged();
  }

  async function add() {
    if (!newName.trim()) return;
    await fetch("/api/pipeline/stages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    }).catch(() => null);
    setNewName("");
    onChanged();
  }

  async function remove(stage: StageDto, moveToId: string | null) {
    setError(null);
    const url = moveToId
      ? `/api/pipeline/stages/${stage.id}?moveTo=${moveToId}`
      : `/api/pipeline/stages/${stage.id}`;
    const res = await fetch(url, { method: "DELETE" }).catch(() => null);
    if (!res) return;
    if (res.status === 409) {
      const data = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      if (data?.error?.code === "stage_has_leads") {
        setDeleting(stage);
        return;
      }
      setError(data?.error?.message ?? "No se pudo eliminar");
      return;
    }
    setDeleting(null);
    setMoveTo("");
    onChanged();
  }

  const sorted = [...stages].sort((a, b) => a.position - b.position);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Etapas del pipeline"
      size="lg"
      testId="stage-manager"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      <ul className="space-y-2">
        {sorted.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2">
            <Input
              defaultValue={s.name}
              onBlur={(e) => void rename(s, e.target.value)}
              className="min-w-0 flex-1 basis-40"
            />
            <div className="flex shrink-0 items-center gap-1">
              {s.kind !== "open" ? (
                <Badge variant={s.kind === "won" ? "success" : "secondary"}>
                  {s.kind === "won" ? "ganado" : "perdido"}
                </Badge>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Eliminar etapa"
                  onClick={() => void remove(s, null)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                disabled={i === 0}
                aria-label="Subir"
                onClick={() => void move(s, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={i === sorted.length - 1}
                aria-label="Bajar"
                onClick={() => void move(s, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {deleting && (
        <div className="mt-4 rounded-md border border-[#ece2cf] bg-[#faf7f0] p-3">
          <p className="text-sm text-[#8a6d3b]">
            &quot;{deleting.name}&quot; tiene tarjetas. Elige a dónde moverlas:
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <select
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
              className="h-11 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm md:h-9"
            >
              <option value="">Etapa destino…</option>
              {sorted
                .filter((s) => s.id !== deleting.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <Button
              variant="destructive"
              size="sm"
              disabled={!moveTo}
              onClick={() => void remove(deleting, moveTo)}
            >
              Mover y eliminar
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex gap-2 border-t pt-4">
        <Input
          placeholder="Nueva etapa…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
        />
        <Button onClick={() => void add()} disabled={!newName.trim()}>
          Agregar
        </Button>
      </div>

      {stale && (
        <div className="mt-4 border-t pt-4" data-testid="stale-setting">
          <label htmlFor="stale-days" className="text-sm font-medium">
            Pasar a Perdido por días sin respuesta
          </label>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Los leads de las etapas abiertas pasan solos a Perdido cuando el cliente no escribe en
            ese tiempo. Si vuelve a escribir, regresan a la etapa de conversación. A los clientes
            nunca los toca.
          </p>
          <select
            id="stale-days"
            value={stale.staleLostDays ?? ""}
            disabled={!stale.canEdit || savingStale}
            onChange={(e) => void saveStale(e.target.value)}
            className="mt-2 h-11 w-full rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60 md:h-9"
          >
            <option value="">Apagado</option>
            {stale.options.map((d) => (
              <option key={d} value={d}>
                {d} días sin respuesta — hoy {stale.preview[d] === 1 ? "pasaría 1 lead" : `pasarían ${stale.preview[d] ?? 0} leads`}
              </option>
            ))}
          </select>
          {!stale.canEdit && (
            <p className="mt-1.5 text-[12px] text-muted-foreground">Lo cambia el propietario de la cuenta.</p>
          )}
          {staleNote && <p className="mt-1.5 text-[12.5px] text-text-2">{staleNote}</p>}
        </div>
      )}
    </Dialog>
  );
}
