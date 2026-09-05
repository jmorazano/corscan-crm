"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
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

type AdminOrganization = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  whatsappConnected: boolean;
  aiConfigured: boolean;
  members: { userId: string; name: string; email: string; role: string }[];
};

export function AdminClient() {
  const [organizations, setOrganizations] = useState<
    AdminOrganization[] | null
  >(null);
  const [orgName, setOrgName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [created, setCreated] = useState<{
    organization: string;
    email: string;
    password: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/admin/organizations").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { organizations: AdminOrganization[] };
    setOrganizations(data.organizations);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Mismo generador que team-client (D7): la contraseña nace en el cliente y
  // el server jamás la devuelve — se muestra UNA sola vez tras crear.
  function generatePassword() {
    const alphabet =
      "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint32Array(14);
    crypto.getRandomValues(bytes);
    setTempPassword(
      Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
    );
  }

  async function create() {
    setSaving(true);
    setError(null);
    setCreated(null);
    const res = await fetch("/api/admin/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationName: orgName,
        admin: { name: adminName, email: adminEmail, password: tempPassword },
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear la empresa");
      return;
    }
    setCreated({
      organization: orgName,
      email: adminEmail,
      password: tempPassword,
    });
    setOrgName("");
    setAdminName("");
    setAdminEmail("");
    setTempPassword("");
    void refetch();
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b px-6 py-4">
        <h2 className="font-semibold">Administración</h2>
      </header>

      <div className="max-w-3xl space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Crear empresa</CardTitle>
            <CardDescription>
              La empresa nace lista (etapas y perfil de agente) con su admin
              inicial. Entrega tú mismo la contraseña temporal: se muestra UNA
              sola vez y el titular deberá cambiarla en su primer ingreso.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="admin-org-name">Nombre de la empresa</Label>
              <Input
                id="admin-org-name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="admin-user-name">Nombre del admin</Label>
                <Input
                  id="admin-user-name"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-user-email">Correo del admin</Label>
                <Input
                  id="admin-user-email"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-user-password">Contraseña temporal</Label>
              <div className="flex gap-2">
                <Input
                  id="admin-user-password"
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
            {created && (
              <div className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3 text-sm">
                <p className="font-medium text-[#3f6b52]">
                  Empresa «{created.organization}» creada ✓
                </p>
                <p className="mt-1 text-[#3f6b52]/90">
                  Guarda y comparte estas credenciales ahora (no se volverán a
                  mostrar):
                  <br />
                  <code>{created.email}</code> · contraseña{" "}
                  <code>{created.password}</code>
                </p>
              </div>
            )}
            <Button
              disabled={
                saving ||
                !orgName.trim() ||
                !adminName.trim() ||
                !adminEmail.trim() ||
                tempPassword.length < 8
              }
              onClick={() => void create()}
            >
              <Building2 className="h-4 w-4" />
              {saving ? "Creando…" : "Crear empresa"}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Empresas
          </p>
          {organizations === null && (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}
          {organizations?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Todavía no hay empresas.
            </p>
          )}
          {organizations?.map((org) => (
            <div
              key={org.id}
              className="space-y-3 rounded-lg border bg-card px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{org.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {org.slug} · creada el{" "}
                    {new Date(org.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant={org.whatsappConnected ? "success" : "secondary"}>
                  {org.whatsappConnected ? "WhatsApp conectado" : "Sin WhatsApp"}
                </Badge>
                <Badge variant={org.aiConfigured ? "success" : "secondary"}>
                  {org.aiConfigured ? "IA configurada" : "IA sin configurar"}
                </Badge>
              </div>
              <div className="space-y-1.5">
                {org.members.length === 0 && (
                  <p className="text-xs text-muted-foreground">Sin usuarios</p>
                )}
                {org.members.map((m) => (
                  <div key={m.userId} className="flex items-center gap-2.5">
                    <ContactAvatar name={m.name} seed={m.userId} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{m.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.email}
                      </p>
                    </div>
                    <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                      {m.role === "owner" ? "Propietario" : "Miembro"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
