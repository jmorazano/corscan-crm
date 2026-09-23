"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Member = {
  id: string;
  role: string;
  name: string;
  email: string;
  createdAt: string;
};

export function TeamClient() {
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/team").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { members: Member[] };
    setMembers(data.members);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  function generatePassword() {
    const alphabet =
      "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint32Array(14);
    crypto.getRandomValues(bytes);
    setTempPassword(
      Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
    );
  }

  // 018: el correo ya tiene cuenta y no es miembro → ofrecer sumarla.
  const [attachOffer, setAttachOffer] = useState<string | null>(null);
  const [attached, setAttached] = useState<string | null>(null);

  async function create() {
    setSaving(true);
    setError(null);
    setCreated(null);
    setAttachOffer(null);
    setAttached(null);
    const res = await fetch("/api/settings/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: tempPassword }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string; code?: string; canAttach?: boolean };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear la cuenta");
      if (data?.error?.code === "duplicate" && data.error.canAttach) {
        setAttachOffer(email.trim().toLowerCase());
      }
      return;
    }
    setCreated({ email, password: tempPassword });
    setName("");
    setEmail("");
    setTempPassword("");
    void refetch();
  }

  /** 018 (FR-008): sumar una cuenta existente como miembro, sin contraseña. */
  async function attachExisting() {
    if (!attachOffer) return;
    setSaving(true);
    setError(null);
    const res = await fetch("/api/settings/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: attachOffer, attachExisting: true }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo sumar la cuenta");
      return;
    }
    setAttached(attachOffer);
    setAttachOffer(null);
    setName("");
    setEmail("");
    setTempPassword("");
    void refetch();
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Crear cuenta de equipo</CardTitle>
          <CardDescription>
            Sin correos ni invitaciones: comparte tú mismo la contraseña
            temporal con tu compañero (se muestra UNA sola vez).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="team-name">Nombre</Label>
              <Input
                id="team-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-email">Correo</Label>
              <Input
                id="team-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-password">Contraseña temporal</Label>
            <div className="flex gap-2">
              <Input
                id="team-password"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                placeholder="mínimo 8 caracteres"
              />
              <Button variant="outline" onClick={generatePassword}>
                Generar
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {attachOffer && (
            <div
              className="rounded-md border border-[#e6dcc4] bg-[#fbf7ec] p-3 text-sm"
              data-testid="team-attach-offer"
            >
              <p className="text-[#6b5a2e]">
                Esa persona ya tiene cuenta en esta instancia. Podés sumarla a
                tu empresa como miembro: conserva su contraseña y verá esta
                empresa junto a la suya en su rail de espacios de trabajo.
              </p>
              <Button
                size="sm"
                className="mt-2"
                disabled={saving}
                onClick={() => void attachExisting()}
                data-testid="team-attach-existing"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {saving ? "Sumando…" : "Sumar esa cuenta a esta empresa"}
              </Button>
            </div>
          )}
          {attached && (
            <div
              className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3 text-sm"
              data-testid="team-user-attached"
            >
              <p className="font-medium text-[#3f6b52]">Cuenta sumada ✓</p>
              <p className="mt-1 text-[#3f6b52]/90">
                <code>{attached}</code> ya puede cambiar a esta empresa desde
                su rail de espacios de trabajo. Conserva su contraseña.
              </p>
            </div>
          )}
          {created && (
            <div className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3 text-sm">
              <p className="font-medium text-[#3f6b52]">Cuenta creada ✓</p>
              <p className="mt-1 text-[#3f6b52]/90">
                Comparte estos datos ahora (no se volverán a mostrar):
                <br />
                <code>{created.email}</code> · contraseña{" "}
                <code>{created.password}</code>
              </p>
            </div>
          )}
          <Button
            disabled={
              saving || !name.trim() || !email.trim() || tempPassword.length < 8
            }
            onClick={() => void create()}
          >
            <UserPlus className="h-4 w-4" />
            {saving ? "Creando…" : "Crear cuenta"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Miembros
        </p>
        {members.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
          >
            <ContactAvatar name={m.name} seed={m.id} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.name}</p>
              <p className="truncate text-xs text-muted-foreground">{m.email}</p>
            </div>
            <Badge variant={m.role === "owner" ? "default" : "secondary"}>
              {m.role === "owner" ? "Propietario" : "Miembro"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
