"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateTempPassword } from "@/components/admin/temp-password";
import { teamRoleLabel, type TeamMemberActions } from "@/lib/team";

type Member = {
  id: string;
  userId: string;
  role: string;
  name: string;
  email: string;
  createdAt: string;
  isSelf: boolean;
  otherOrganizations: number;
  actions: TeamMemberActions;
};

/** 045: acción en curso sobre una persona (se confirma en un diálogo). */
type Pending = { kind: "role" | "reset" | "remove"; member: Member };

type ApiErrorBody = { error?: { message?: string } } | null;

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
    setTempPassword(generateTempPassword());
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

      <TeamMembers members={members} onChanged={refetch} />
    </div>
  );
}

/**
 * 045: el equipo con lo que el propietario puede hacer sobre cada persona.
 * Las reglas vienen del servidor (`actions`, misma función pura que la
 * guarda de la API): si algo no se puede, el diálogo dice por qué — sirve
 * igual en el celular, donde no hay tooltips.
 */
function TeamMembers({
  members,
  onChanged,
}: {
  members: Member[];
  onChanged: () => Promise<void>;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<
    | { kind: "reset"; userId: string; email: string; password: string }
    | { kind: "removed"; email: string; accountDeleted: boolean }
    | { kind: "role"; userId: string; name: string; role: string }
    | null
  >(null);

  function open(kind: Pending["kind"], member: Member) {
    setDialogError(null);
    setPending({ kind, member });
  }

  function close() {
    if (!busy) setPending(null);
  }

  async function confirm() {
    if (!pending) return;
    const { kind, member } = pending;
    setBusy(true);
    setDialogError(null);
    const base = `/api/settings/team/${encodeURIComponent(member.userId)}`;
    const nextRole = member.role === "owner" ? "member" : "owner";
    const password = kind === "reset" ? generateTempPassword() : "";
    const res = await fetch(
      kind === "reset" ? `${base}/password` : base,
      kind === "remove"
        ? { method: "DELETE" }
        : {
            method: kind === "reset" ? "POST" : "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              kind === "reset" ? { password } : { role: nextRole }
            ),
          }
    ).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as ApiErrorBody;
      setDialogError(data?.error?.message ?? "No se pudo completar la acción");
      return;
    }
    if (kind === "reset") {
      setNotice({ kind: "reset", userId: member.userId, email: member.email, password });
    } else if (kind === "remove") {
      const data = (await res.json().catch(() => ({}))) as { accountDeleted?: boolean };
      setNotice({
        kind: "removed",
        email: member.email,
        accountDeleted: data.accountDeleted === true,
      });
    } else {
      setNotice({ kind: "role", userId: member.userId, name: member.name, role: nextRole });
    }
    setPending(null);
    void onChanged();
  }

  const blocked = pending
    ? pending.member.actions[
        pending.kind === "role"
          ? "changeRole"
          : pending.kind === "reset"
            ? "resetPassword"
            : "remove"
      ]
    : null;

  return (
    <div className="space-y-2" data-testid="team-members">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Miembros
      </p>
      {members.map((m) => {
        // Sobre sí mismo y sobre cuentas de la plataforma no hay acciones.
        const manageable =
          m.actions.remove.ok || m.actions.remove.code === "last_owner";
        return (
          <div key={m.id} className="space-y-1.5" data-testid="team-member" data-user-id={m.userId}>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
              <ContactAvatar name={m.name} seed={m.id} size="sm" />
              {/* basis: en el celular los botones bajan a otra línea antes
                  que dejar el nombre en «L…». */}
              <div className="min-w-0 flex-1 basis-36">
                <p className="truncate text-sm font-medium">
                  {m.name}
                  {m.isSelf && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">(vos)</span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
              </div>
              <Badge variant={m.role === "owner" ? "default" : "secondary"} data-testid="team-member-role">
                {teamRoleLabel(m.role)}
              </Badge>
              {manageable && (
                <div className="ml-auto flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => open("role", m)}
                    title="Cambiar rol"
                    aria-label="Cambiar rol"
                    data-testid="team-change-role"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">Rol</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => open("reset", m)}
                    title="Restablecer contraseña"
                    aria-label="Restablecer contraseña"
                    data-testid="team-reset-password"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">Contraseña</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => open("remove", m)}
                    title="Quitar de la empresa"
                    aria-label="Quitar de la empresa"
                    data-testid="team-remove"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">Quitar</span>
                  </Button>
                </div>
              )}
            </div>
            {notice?.kind === "reset" && notice.userId === m.userId && (
              <div
                className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3 text-sm"
                data-testid="team-reset-done"
              >
                <p className="font-medium text-[#3f6b52]">Contraseña restablecida ✓</p>
                <p className="mt-1 text-[#3f6b52]/90">
                  Compartí la temporal ahora (no se volverá a mostrar). Al entrar
                  va a tener que elegir una propia:
                  <br />
                  <code>{notice.email}</code> · contraseña <code>{notice.password}</code>
                </p>
              </div>
            )}
            {notice?.kind === "role" && notice.userId === m.userId && (
              <p className="px-1 text-sm text-[#3f6b52]" data-testid="team-role-done">
                {notice.name} ahora es {teamRoleLabel(notice.role).toLowerCase()} ✓
              </p>
            )}
          </div>
        );
      })}

      {notice?.kind === "removed" && (
        <div
          className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3 text-sm"
          data-testid="team-removed"
        >
          <p className="font-medium text-[#3f6b52]">
            {notice.accountDeleted ? "Quitado y cuenta eliminada ✓" : "Quitado de la empresa ✓"}
          </p>
          <p className="mt-1 text-[#3f6b52]/90">
            <code>{notice.email}</code>{" "}
            {notice.accountDeleted
              ? "no pertenecía a ninguna otra empresa: su cuenta ya no existe."
              : "conserva su cuenta en sus otras empresas."}
          </p>
        </div>
      )}

      <Dialog
        open={pending !== null}
        onClose={close}
        size="sm"
        testId="team-dialog"
        title={
          pending?.kind === "reset"
            ? "Restablecer contraseña"
            : pending?.kind === "remove"
              ? "Quitar de la empresa"
              : pending?.member.role === "owner"
                ? "Pasar a miembro"
                : "Hacer propietario"
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={close}>
              {blocked?.ok === false ? "Entendido" : "Cancelar"}
            </Button>
            {blocked?.ok && (
              <Button
                variant={pending?.kind === "remove" ? "destructive" : "default"}
                disabled={busy}
                onClick={() => void confirm()}
                data-testid="team-dialog-confirm"
              >
                {busy
                  ? "Guardando…"
                  : pending?.kind === "reset"
                    ? "Generar contraseña nueva"
                    : pending?.kind === "remove"
                      ? "Quitar"
                      : "Confirmar"}
              </Button>
            )}
          </div>
        }
      >
        {pending && (
          <div className="space-y-2 text-sm">
            {blocked?.ok === false ? (
              <p data-testid="team-dialog-blocked">{blocked.reason}.</p>
            ) : pending.kind === "reset" ? (
              <>
                <p>
                  Se genera una contraseña temporal nueva para{" "}
                  <strong>{pending.member.name}</strong> (<code>{pending.member.email}</code>).
                </p>
                <p className="text-muted-foreground">
                  Se cierran sus sesiones abiertas y, al volver a entrar, va a tener
                  que elegir una contraseña propia. La temporal se muestra una sola vez.
                </p>
              </>
            ) : pending.kind === "remove" ? (
              <>
                <p>
                  <strong>{pending.member.name}</strong> (<code>{pending.member.email}</code>)
                  deja de tener acceso a esta empresa y deja de recibir sus notificaciones.
                </p>
                <p className="text-muted-foreground">
                  {pending.member.otherOrganizations > 0
                    ? "Usa también otras empresas: conserva su cuenta en ellas."
                    : "No pertenece a ninguna otra empresa: su cuenta se elimina y no podrá volver a entrar."}{" "}
                  Sus conversaciones y notas quedan en la empresa.
                </p>
              </>
            ) : pending.member.role === "owner" ? (
              <>
                <p>
                  <strong>{pending.member.name}</strong> pasa a ser miembro.
                </p>
                <p className="text-muted-foreground">
                  Va a seguir operando la bandeja, el pipeline, los contactos y las
                  campañas, pero ya no podrá configurar el agente, las integraciones,
                  los ajustes ni el equipo.
                </p>
              </>
            ) : (
              <>
                <p>
                  <strong>{pending.member.name}</strong> pasa a ser propietario.
                </p>
                <p className="text-muted-foreground">
                  Va a poder configurar todo: el agente, las integraciones, los
                  ajustes y el equipo — incluso quitarte o cambiar tu rol.
                </p>
              </>
            )}
            {dialogError && (
              <p className="text-destructive" data-testid="team-dialog-error">
                {dialogError}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
