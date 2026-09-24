import { describe, expect, it } from "vitest";
import {
  canManageConfig,
  memberCanOpen,
  navItemsFor,
  settingsHomeFor,
} from "@/lib/roles";

/**
 * Roles de empresa (022): el miembro opera, el propietario configura. Las
 * mismas reglas alimentan el sidebar, la hoja «Más», Ajustes y las guardas.
 */
describe("canManageConfig", () => {
  it("solo el propietario configura", () => {
    expect(canManageConfig("owner")).toBe(true);
    expect(canManageConfig("member")).toBe(false);
    expect(canManageConfig("")).toBe(false);
    expect(canManageConfig("admin")).toBe(false);
  });
});

describe("memberCanOpen", () => {
  it("deja lo operativo y lo personal", () => {
    for (const p of [
      "/inbox",
      "/inbox?c=cv_1",
      "/pipeline",
      "/contacts",
      "/campaigns/cmp_1",
      "/settings/notifications",
      "/change-password",
    ]) {
      expect(memberCanOpen(p), p).toBe(true);
    }
  });

  it("cierra la configuración de la empresa", () => {
    for (const p of [
      "/agent",
      "/lab",
      "/lab/runs/1",
      "/integrations",
      "/integrations/google-calendar",
      "/integrations/mcp",
      "/settings",
      "/settings/whatsapp",
      "/settings/ai",
      "/settings/sending",
      "/settings/branding",
      "/settings/templates",
      "/settings/team",
      "/settings/api",
      "/settings/datos",
    ]) {
      expect(memberCanOpen(p), p).toBe(false);
    }
  });

  it("no confunde prefijos (/agente no es /agent)", () => {
    expect(memberCanOpen("/agente")).toBe(true);
    expect(memberCanOpen("/settings/notificationsx")).toBe(false);
  });
});

describe("settingsHomeFor", () => {
  it("el propietario cae en WhatsApp, el miembro en Notificaciones", () => {
    expect(settingsHomeFor("owner")).toBe("/settings/whatsapp");
    expect(settingsHomeFor("member")).toBe("/settings/notifications");
  });
});

describe("navItemsFor", () => {
  const items = [
    { href: "/inbox", label: "Bandeja" },
    { href: "/agent", label: "Agente" },
    { href: "/lab", label: "Laboratorio" },
    { href: "/integrations", label: "Integraciones" },
    { href: "/settings/notifications", label: "Notificaciones" },
    { href: "/settings", label: "Ajustes" },
    { href: "/change-password", label: "Mi contraseña" },
  ] as const;

  it("el propietario ve todo, en el mismo orden", () => {
    expect(navItemsFor("owner", items)).toEqual(items);
  });

  it("el miembro ve solo lo operativo y lo personal", () => {
    expect(navItemsFor("member", items).map((i) => i.href)).toEqual([
      "/inbox",
      "/settings/notifications",
      "/change-password",
    ]);
  });
});
