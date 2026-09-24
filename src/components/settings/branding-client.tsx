"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ACCENT_PRESETS,
  isValidHex,
  MAX_INITIALS_LENGTH,
  resolveAccentSet,
  resolveInitials,
  type Branding,
} from "@/lib/branding";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function BrandingClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [accent, setAccent] = useState("#3f5972");
  const [initials, setInitials] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings/branding")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { branding: Branding } | null) => {
        if (d) {
          setName(d.branding.name);
          setAccent(d.branding.accent);
          setInitials(d.branding.initials ?? "");
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const isPreset = accent.toLowerCase() in ACCENT_PRESETS;
  const previewSet = resolveAccentSet(accent);
  const previewName = name.trim() || "Vocero";
  const tileInitials = resolveInitials({ name: previewName, initials });

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/settings/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), accent, initials: initials.trim() }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo guardar");
      return;
    }
    setSaved(true);
    // Re-renderiza el árbol server (layout raíz inyecta el acento y el título)
    router.refresh();
  }

  if (!loaded) return <p className="text-sm text-text-3">Cargando…</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Marca del CRM</CardTitle>
          <CardDescription>
            Este CRM es tuyo: ponle el nombre de tu negocio y tu color. Se
            reflejan en toda la interfaz y en la pantalla de inicio de sesión.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-start gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="brand-name">Nombre</Label>
              <Input
                id="brand-name"
                maxLength={30}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Vocero"
                className="max-w-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="brand-initials">Iniciales del espacio</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="brand-initials"
                  maxLength={MAX_INITIALS_LENGTH}
                  value={initials}
                  onChange={(e) =>
                    setInitials(
                      e.target.value
                        .toUpperCase()
                        .replace(/[^\p{L}\d]/gu, "")
                        .slice(0, MAX_INITIALS_LENGTH)
                    )
                  }
                  placeholder={resolveInitials({ name: previewName })}
                  className="w-20 text-center"
                />
                <span
                  aria-hidden
                  title="Así se ve en el selector de empresas"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[14px] font-semibold text-white"
                  style={{ backgroundColor: previewSet.accent }}
                >
                  {tileInitials}
                </span>
              </div>
              <p className="text-xs text-text-3">
                Para distinguir esta empresa en el selector de la izquierda
                cuando manejás más de una. Vacío = se calculan del nombre.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Color de acento</Label>
            <div className="flex flex-wrap items-center gap-2">
              {Object.entries(ACCENT_PRESETS).map(([hex, preset]) => (
                <button
                  key={hex}
                  onClick={() => setAccent(hex)}
                  title={preset.label}
                  aria-label={preset.label}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                    accent.toLowerCase() === hex
                      ? "border-foreground/40 bg-secondary"
                      : "hover:bg-accent"
                  )}
                >
                  {/* 012: muestra ≥ 32 px en móvil para el dedo. */}
                  <span
                    className="h-8 w-8 rounded-full md:h-4 md:w-4"
                    style={{ background: hex }}
                  />
                  {preset.label}
                </button>
              ))}
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  !isPreset ? "border-foreground/40 bg-secondary" : "hover:bg-accent"
                )}
              >
                <input
                  type="color"
                  aria-label="Color personalizado"
                  value={isValidHex(accent) ? accent : "#3f5972"}
                  onChange={(e) => setAccent(e.target.value)}
                  className="h-8 w-8 cursor-pointer appearance-none border-0 bg-transparent p-0 md:h-4 md:w-4"
                />
                Personalizado
              </label>
            </div>
            <p className="text-xs text-text-3">
              Con un color personalizado, los tonos derivados (hover, fondos
              suaves) se calculan solos y se ajusta el contraste.
            </p>
          </div>

          {/* Vista previa */}
          <div className="rounded-md border p-4" style={{ background: previewSet.tint }}>
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-[30px] w-[30px] items-center justify-center rounded-sm text-[15px] font-bold text-white"
                style={{ background: previewSet.accent }}
              >
                {(name.trim() || "Vocero").charAt(0).toUpperCase()}
              </span>
              <span>
                <span className="block text-[15px] font-[650] leading-tight">
                  {name.trim() || "Vocero"}
                </span>
                <span className="block text-[11px] text-text-3">CRM · WhatsApp</span>
              </span>
              <span className="flex-1" />
              <span
                className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
                style={{ background: previewSet.accent }}
              >
                Botón de ejemplo
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm" style={{ color: previewSet.text }}>Marca guardada ✓</p>}
          <Button disabled={saving || !name.trim()} onClick={() => void save()}>
            {saving ? "Guardando…" : "Guardar marca"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
