"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, UserMinus, UserPlus } from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
import {
  type AdminOrganization,
  mcpCell,
} from "@/components/admin/admin-client";
import { McpAdminCard } from "@/components/admin/mcp-admin-client";
import { generateTempPassword } from "@/components/admin/temp-password";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Member = AdminOrganization["members"][number];

type ApiErrorBody = {
  error?: { message?: string; code?: string; canAttach?: boolean };
} | null;

/**
 * Detalle de una empresa en Administración (019, FR-003): estado, usuarios
 * (alta, sumar existente, restablecer contraseña, quitar) y conector MCP.
 * La protección real es server-side (la página redirige si no es super
 * admin); acá solo se consume `GET /api/admin/organizations/[id]`.
 */
export function OrganizationDetailClient({
  organizationId,
}: {
  organizationId: string;
}) {
  const router = useRouter();
  const [org, setOrg] = useState<AdminOrganization | null>(null);
  const [missing, setMissing] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/admin/organizations/${organizationId}`).catch(
      () => null
    );
    if (res?.status === 404) {
      setMissing(true);
      return;
    }
    if (!res?.ok) return;
    const data = (await res.json()) as { organization: AdminOrganization };
    setOrg(data.organization);
  }, [organizationId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const back = () => router.push("/admin");

  if (missing) {
    return (
      <div className="p-4 md:p-6">
        <Button variant="ghost" size="sm" onClick={back}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Volver a Administración
        </Button>
        <p className="mt-4 text-sm text-muted-foreground" data-testid="admin-org-missing">
          Esta empresa ya no existe.
        </p>
      </div>
    );
  }
  if (!org) {
    return (
      <div className="p-4 text-sm text-muted-foreground md:p-6">Cargando empresa…</div>
    );
  }

  const mcp = mcpCell(org.mcp);

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:gap-4 md:px-6 md:py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" onClick={back} aria-label="Volver a Administración">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h2 className="truncate font-semibold" data-testid="admin-org-name">
              {org.name}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {org.slug} · creada el {new Date(org.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          <Badge variant={org.whatsappConnected ? "success" : "secondary"}>
            {org.whatsappConnected ? "WhatsApp conectado" : "Sin WhatsApp"}
          </Badge>
          <Badge variant={org.aiConfigured ? "success" : "secondary"}>
            {org.aiConfigured ? "IA configurada" : "IA sin configurar"}
          </Badge>
          <Badge variant={mcp.variant}>Conector: {mcp.label}</Badge>
        </div>
      </header>

      <div className="max-w-3xl space-y-6 p-4 md:p-6">
        <MembersCard org={org} onChanged={refetch} />

        <McpAdminCard
          organizationId={org.id}
          organizationName={org.name}
          mcp={org.mcp}
          onChanged={refetch}
        />
      </div>
    </div>
  );
}

function MembersCard({
  org,
  onChanged,
}: {
  org: AdminOrganization;
  onChanged: () => Promise<void>;
}) {
  // Reset de contraseña por usuario (US5 de 003): temporal nueva mostrada una vez.
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [resetError, setResetError] = useState<{ userId: string; message: string } | null>(
    null
  );
  const [resetDone, setResetDone] = useState<{
    userId: string;
    email: string;
    password: string;
  } | null>(null);

  // 019: quitar de la empresa (con confirmación).
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ email: string; accountDeleted: boolean } | null>(
    null
  );

  // Alta de usuario (US5 de 003) + sumar cuenta existente (018).
  const [addOpen, setAddOpen] = useState(false);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState<"owner" | "member">("member");
  const [userPassword, setUserPassword] = useState("");
  const [userError, setUserError] = useState<string | null>(null);
  const [userSaving, setUserSaving] = useState(false);
  const [userCreated, setUserCreated] = useState<{ email: string; password: string } | null>(
    null
  );
  const [attachOffer, setAttachOffer] = useState<{
    email: string;
    role: "owner" | "member";
  } | null>(null);
  const [attached, setAttached] = useState<string | null>(null);

  function openAdd() {
    setAddOpen(true);
    setUserName("");
    setUserEmail("");
    setUserRole("member");
    setUserPassword("");
    setUserError(null);
    setUserCreated(null);
    setAttachOffer(null);
    setAttached(null);
  }

  async function resetPassword(userId: string, email: string) {
    if (
      !window.confirm(
        `¿Restablecer la contraseña de ${email}? Se cerrarán sus sesiones activas y deberá cambiarla en su próximo ingreso.`
      )
    ) {
      return;
    }
    const password = generateTempPassword();
    setResettingUserId(userId);
    setResetError(null);
    setResetDone(null);
    const res = await fetch(`/api/admin/users/${userId}/password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    setResettingUserId(null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as ApiErrorBody;
      setResetError({
        userId,
        message: data?.error?.message ?? "No se pudo restablecer la contraseña",
      });
      return;
    }
    setResetDone({ userId, email, password });
  }

  async function removeUser() {
    if (!removeTarget) return;
    setRemoving(true);
    setRemoveError(null);
    const res = await fetch(
      `/api/admin/organizations/${org.id}/users/${removeTarget.userId}`,
      { method: "DELETE" }
    ).catch(() => null);
    setRemoving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as ApiErrorBody;
      setRemoveError(data?.error?.message ?? "No se pudo quitar el usuario");
      return;
    }
    const data = (await res.json()) as { accountDeleted: boolean };
    setRemoved({ email: removeTarget.email, accountDeleted: data.accountDeleted });
    setRemoveTarget(null);
    void onChanged();
  }

  async function createUser() {
    setUserSaving(true);
    setUserError(null);
    setUserCreated(null);
    setAttachOffer(null);
    const res = await fetch(`/api/admin/organizations/${org.id}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: userName,
        email: userEmail,
        password: userPassword,
        role: userRole,
      }),
    }).catch(() => null);
    setUserSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as ApiErrorBody;
      setUserError(data?.error?.message ?? "No se pudo crear el usuario");
      if (data?.error?.code === "duplicate_email" && data.error.canAttach) {
        setAttachOffer({ email: userEmail.trim().toLowerCase(), role: userRole });
      }
      return;
    }
    setUserCreated({ email: userEmail, password: userPassword });
    setAddOpen(false);
    void onChanged();
  }

  async function attachExisting() {
    if (!attachOffer) return;
    setUserSaving(true);
    setUserError(null);
    const res = await fetch(`/api/admin/organizations/${org.id}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: attachOffer.email,
        role: attachOffer.role,
        attachExisting: true,
      }),
    }).catch(() => null);
    setUserSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as ApiErrorBody;
      setUserError(data?.error?.message ?? "No se pudo sumar la cuenta");
      return;
    }
    setAttached(attachOffer.email);
    setAttachOffer(null);
    setAddOpen(false);
    void onChanged();
  }

  const owners = org.members.filter((m) => m.role === "owner").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usuarios</CardTitle>
        <CardDescription>
          {org.members.length === 0
            ? "Esta empresa todavía no tiene usuarios."
            : `${org.members.length} ${org.members.length === 1 ? "cuenta" : "cuentas"} · ${owners} ${owners === 1 ? "propietario" : "propietarios"}. Quitar a alguien le saca esta empresa; si no le queda ninguna, su cuenta se elimina.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5" data-testid="admin-org-members">
          {org.members.map((m) => (
            <div key={m.userId} className="space-y-1.5" data-testid="admin-member" data-user-id={m.userId}>
              <div className="flex flex-wrap items-center gap-2.5 rounded-md border px-3 py-2">
                <ContactAvatar name={m.name} seed={m.userId} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                  {m.role === "owner" ? "Propietario" : "Miembro"}
                </Badge>
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resettingUserId === m.userId}
                    onClick={() => void resetPassword(m.userId, m.email)}
                    title="Restablecer contraseña"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">
                      {resettingUserId === m.userId ? "Restableciendo…" : "Restablecer contraseña"}
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      setRemoveError(null);
                      setRemoved(null);
                      setRemoveTarget(m);
                    }}
                    title="Quitar de la empresa"
                    data-testid="admin-remove-user"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">Quitar</span>
                  </Button>
                </div>
              </div>
              {resetDone?.userId === m.userId && (
                <div className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3 text-sm">
                  <p className="font-medium text-[#3f6b52]">Contraseña restablecida ✓</p>
                  <p className="mt-1 text-[#3f6b52]/90">
                    Compartí la temporal nueva ahora (no se volverá a mostrar):
                    <br />
                    <code>{resetDone.email}</code> · contraseña <code>{resetDone.password}</code>
                  </p>
                </div>
              )}
              {resetError?.userId === m.userId && (
                <p className="text-sm text-destructive">{resetError.message}</p>
              )}
            </div>
          ))}
        </div>

        {removed && (
          <div
            className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3 text-sm"
            data-testid="admin-user-removed"
          >
            <p className="font-medium text-[#3f6b52]">
              {removed.accountDeleted ? "Usuario quitado y cuenta eliminada ✓" : "Usuario quitado ✓"}
            </p>
            <p className="mt-1 text-[#3f6b52]/90">
              <code>{removed.email}</code>{" "}
              {removed.accountDeleted
                ? "no pertenecía a ninguna otra empresa: su cuenta ya no existe."
                : "conserva su cuenta y sus otras empresas."}
            </p>
          </div>
        )}
        {userCreated && (
          <div className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3 text-sm">
            <p className="font-medium text-[#3f6b52]">Usuario creado ✓</p>
            <p className="mt-1 text-[#3f6b52]/90">
              Compartí estas credenciales ahora (no se volverán a mostrar):
              <br />
              <code>{userCreated.email}</code> · contraseña <code>{userCreated.password}</code>
            </p>
          </div>
        )}
        {attached && (
          <div
            className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3 text-sm"
            data-testid="admin-user-attached"
          >
            <p className="font-medium text-[#3f6b52]">Cuenta sumada ✓</p>
            <p className="mt-1 text-[#3f6b52]/90">
              <code>{attached}</code> ya puede cambiar a esta empresa desde su rail de
              espacios de trabajo. Conserva su contraseña.
            </p>
          </div>
        )}

        {addOpen ? (
          <div className="space-y-3 rounded-md border p-3" data-testid="admin-add-user-form">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="admin-new-user-name">Nombre</Label>
                <Input
                  id="admin-new-user-name"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-new-user-email">Correo</Label>
                <Input
                  id="admin-new-user-email"
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="admin-new-user-role">Rol</Label>
                <select
                  id="admin-new-user-role"
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value as "owner" | "member")}
                  className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm md:h-9"
                >
                  <option value="member">Miembro</option>
                  <option value="owner">Propietario</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-new-user-password">Contraseña temporal</Label>
                <div className="flex gap-2">
                  <Input
                    id="admin-new-user-password"
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    placeholder="mínimo 8 caracteres"
                  />
                  <Button variant="outline" onClick={() => setUserPassword(generateTempPassword())}>
                    Generar
                  </Button>
                </div>
              </div>
            </div>
            {userError && <p className="text-sm text-destructive">{userError}</p>}
            {attachOffer && (
              <div
                className="rounded-md border border-[#e6dcc4] bg-[#fbf7ec] p-3 text-sm"
                data-testid="admin-attach-offer"
              >
                <p className="text-[#6b5a2e]">
                  Esa persona ya tiene cuenta en esta instancia. Podés sumarla a{" "}
                  <strong>{org.name}</strong> como{" "}
                  {attachOffer.role === "owner" ? "propietaria" : "miembro"}: conserva su
                  contraseña y verá esta empresa junto a la suya en su rail de espacios de
                  trabajo.
                </p>
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={userSaving}
                  onClick={() => void attachExisting()}
                  data-testid="admin-attach-existing"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  {userSaving ? "Sumando…" : "Sumar esa cuenta a esta empresa"}
                </Button>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                disabled={
                  userSaving || !userName.trim() || !userEmail.trim() || userPassword.length < 8
                }
                onClick={() => void createUser()}
              >
                <UserPlus className="h-4 w-4" />
                {userSaving ? "Creando…" : "Crear usuario"}
              </Button>
              <Button variant="ghost" onClick={() => setAddOpen(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={openAdd} data-testid="admin-add-user">
            <UserPlus className="h-3.5 w-3.5" />
            Agregar usuario
          </Button>
        )}
      </CardContent>

      <Dialog
        open={removeTarget !== null}
        onClose={() => (removing ? undefined : setRemoveTarget(null))}
        title="Quitar de la empresa"
        size="sm"
        testId="admin-remove-dialog"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={removing} onClick={() => setRemoveTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={() => void removeUser()}
              data-testid="admin-remove-confirm"
            >
              <UserMinus className="h-4 w-4" />
              {removing ? "Quitando…" : "Quitar"}
            </Button>
          </div>
        }
      >
        {removeTarget && (
          <div className="space-y-2 text-sm">
            <p>
              <strong>{removeTarget.name}</strong> (<code>{removeTarget.email}</code>) dejará
              de tener acceso a <strong>{org.name}</strong>.
            </p>
            <p className="text-text-2">
              Si no pertenece a ninguna otra empresa, su cuenta se elimina y no podrá
              volver a entrar. Si tiene otras, conserva su cuenta.
            </p>
            {removeError && <p className="text-destructive">{removeError}</p>}
          </div>
        )}
      </Dialog>
    </Card>
  );
}
