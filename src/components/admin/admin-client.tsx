"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ChevronRight, Plug, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { McpAdminSummary } from "@/components/admin/mcp-admin-client";
import { McpOverviewClient } from "@/components/admin/mcp-overview-client";
import { generateTempPassword } from "@/components/admin/temp-password";
import { useQueryFilters } from "@/components/use-query-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** DTO de `GET /api/admin/organizations` (contrato admin-api.md + 016). */
export type AdminOrganization = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  whatsappConnected: boolean;
  aiConfigured: boolean;
  /** 016: conector MCP de esta empresa; null/ausente = sin fila. */
  mcp?: McpAdminSummary | null;
  members: { userId: string; name: string; email: string; role: string }[];
};

type Tab = "orgs" | "mcp";

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "orgs", label: "Empresas", icon: Building2 },
  { id: "mcp", label: "Conectores MCP", icon: Plug },
];

/** Etiqueta del conector para la tabla (mismo vocabulario que el panel MCP). */
export function mcpCell(mcp: McpAdminSummary | null | undefined): {
  label: string;
  variant: "success" | "secondary" | "warning" | "destructive";
} {
  if (!mcp) return { label: "Sin conector", variant: "secondary" };
  if (!mcp.enabled || mcp.status === "disabled")
    return { label: "Deshabilitado", variant: "secondary" };
  if (mcp.status === "connected") return { label: "Conectado", variant: "success" };
  if (mcp.status === "reconnect_required")
    return { label: "Requiere reconexión", variant: "destructive" };
  return { label: "Sin conectar", variant: "warning" };
}

/**
 * Administración (019): dos pestañas — «Empresas» (tabla + alta en diálogo,
 * cada fila lleva a `/admin/organizations/[id]`) y «Conectores MCP» (panel
 * consolidado de 016). La pestaña activa vive en `?tab=` (FR-001).
 */
export function AdminClient() {
  const { params, set } = useQueryFilters();
  const tab: Tab = params.get("tab") === "mcp" ? "mcp" : "orgs";

  const [organizations, setOrganizations] = useState<AdminOrganization[] | null>(
    null
  );
  const refetch = useCallback(async () => {
    const res = await fetch("/api/admin/organizations").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { organizations: AdminOrganization[] };
    setOrganizations(data.organizations);
  }, []);
  useEffect(() => {
    void refetch();
  }, [refetch]);

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b px-4 pt-3 md:px-6 md:pt-4">
        <h2 className="font-semibold">Administración</h2>
        <div role="tablist" aria-label="Secciones de administración" className="-mb-px mt-2 flex gap-1">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`admin-tab-${t.id}`}
                onClick={() => set({ tab: t.id === "orgs" ? null : t.id })}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-brand text-foreground"
                    : "border-transparent text-text-2 hover:text-foreground"
                )}
              >
                <t.icon className="h-4 w-4" strokeWidth={1.7} />
                {t.label}
                {t.id === "orgs" && organizations && (
                  <span className="rounded-full bg-secondary px-1.5 text-[11px] text-text-3">
                    {organizations.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      <div className="p-4 md:p-6">
        {tab === "orgs" ? (
          <OrganizationsTab organizations={organizations} onChanged={refetch} />
        ) : (
          <div className="max-w-3xl">
            <McpOverviewClient onChanged={refetch} />
          </div>
        )}
      </div>
    </div>
  );
}

function OrganizationsTab({
  organizations,
  onChanged,
}: {
  organizations: AdminOrganization[] | null;
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-2">
          Cada empresa tiene su propio WhatsApp, agente, usuarios y conector.
          Entrá a una para gestionarla.
        </p>
        <Button onClick={() => setCreateOpen(true)} data-testid="admin-new-org">
          <Plus className="h-4 w-4" />
          Nueva empresa
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[760px] text-sm" data-testid="admin-orgs-table">
          <thead className="bg-subtle text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-normal">Empresa</th>
              <th className="px-3 py-2.5 font-normal">Usuarios</th>
              <th className="px-3 py-2.5 font-normal">WhatsApp</th>
              <th className="px-3 py-2.5 font-normal">IA</th>
              <th className="px-3 py-2.5 font-normal">Conector</th>
              <th className="px-3 py-2.5 font-normal">Alta</th>
              <th className="w-10 px-2 py-2.5" aria-label="Abrir" />
            </tr>
          </thead>
          <tbody>
            {organizations === null && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            )}
            {organizations?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  Todavía no hay empresas.
                </td>
              </tr>
            )}
            {organizations?.map((org) => {
              const href = `/admin/organizations/${org.id}`;
              const mcp = mcpCell(org.mcp);
              const owners = org.members.filter((m) => m.role === "owner").length;
              return (
                <tr
                  key={org.id}
                  data-testid="admin-org-row"
                  data-org-id={org.id}
                  onClick={() => router.push(href)}
                  className="cursor-pointer border-t transition-colors hover:bg-accent"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={href}
                      className="block truncate font-medium text-foreground hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {org.name}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {org.slug}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-text-2">
                    {org.members.length}
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      · {owners} {owners === 1 ? "propietario" : "propietarios"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <Badge variant={org.whatsappConnected ? "success" : "secondary"}>
                      {org.whatsappConnected ? "Conectado" : "Sin conectar"}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <Badge variant={org.aiConfigured ? "success" : "secondary"}>
                      {org.aiConfigured ? "Configurada" : "Sin configurar"}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <Badge variant={mcp.variant}>{mcp.label}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">
                    {new Date(org.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-2 py-3 text-text-3">
                    <ChevronRight className="h-4 w-4" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <CreateOrganizationDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={onChanged}
      />
    </div>
  );
}

/**
 * Alta de empresa (US1 de 003) en un diálogo: la empresa nace lista con su
 * admin inicial; la contraseña temporal se muestra UNA sola vez.
 */
function CreateOrganizationDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [orgName, setOrgName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [created, setCreated] = useState<{
    organizationId: string;
    organization: string;
    email: string;
    password: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  function reset() {
    setOrgName("");
    setAdminName("");
    setAdminEmail("");
    setTempPassword("");
    setCreated(null);
    setError(null);
  }

  async function create() {
    setSaving(true);
    setError(null);
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
    const data = (await res.json()) as { organizationId: string };
    setCreated({
      organizationId: data.organizationId,
      organization: orgName,
      email: adminEmail,
      password: tempPassword,
    });
    void onCreated();
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title="Nueva empresa"
      description="La empresa nace lista (etapas y perfil de agente) con su admin inicial. Entregá vos la contraseña temporal: se muestra UNA sola vez y el titular deberá cambiarla en su primer ingreso."
      size="lg"
      testId="admin-create-org"
      footer={
        created ? (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                onClose();
                reset();
              }}
            >
              Cerrar
            </Button>
            <Button
              onClick={() => {
                const href = `/admin/organizations/${created.organizationId}`;
                onClose();
                reset();
                router.push(href);
              }}
            >
              Abrir la empresa
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                onClose();
                reset();
              }}
            >
              Cancelar
            </Button>
            <Button
              disabled={
                saving ||
                !orgName.trim() ||
                !adminName.trim() ||
                !adminEmail.trim() ||
                tempPassword.length < 8
              }
              onClick={() => void create()}
              data-testid="admin-create-org-submit"
            >
              <Building2 className="h-4 w-4" />
              {saving ? "Creando…" : "Crear empresa"}
            </Button>
          </div>
        )
      }
    >
      {created ? (
        <div className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] p-3 text-sm">
          <p className="font-medium text-[#3f6b52]">
            Empresa «{created.organization}» creada ✓
          </p>
          <p className="mt-1 text-[#3f6b52]/90">
            Guardá y compartí estas credenciales ahora (no se volverán a
            mostrar):
            <br />
            <code>{created.email}</code> · contraseña <code>{created.password}</code>
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="admin-org-name">Nombre de la empresa</Label>
            <Input
              id="admin-org-name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              autoFocus
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
              <Button
                variant="outline"
                onClick={() => setTempPassword(generateTempPassword())}
              >
                Generar
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}
