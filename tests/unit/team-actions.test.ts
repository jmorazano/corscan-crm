import { describe, expect, it } from "vitest";
import { teamMemberActions, type TeamMemberFacts } from "@/lib/team";

/**
 * 045: qué puede hacer el propietario sobre cada persona del equipo. La
 * misma función es la guarda de la API y la que pinta los diálogos.
 */

const base: TeamMemberFacts = {
  role: "member",
  isSelf: false,
  isPlatform: false,
  otherOrganizations: 0,
  ownerCount: 1,
};

describe("teamMemberActions", () => {
  it("miembro de una sola empresa → puede quitarlo, resetearle la contraseña y cambiarle el rol", () => {
    const a = teamMemberActions(base);
    expect(a.remove.ok && a.resetPassword.ok && a.changeRole.ok).toBe(true);
  });

  it("sobre sí mismo nada se hace desde Equipo", () => {
    const a = teamMemberActions({ ...base, role: "owner", isSelf: true, ownerCount: 3 });
    for (const check of Object.values(a)) {
      expect(check).toMatchObject({ ok: false, code: "self" });
    }
  });

  it("cuenta de la plataforma → intocable aunque sea miembro", () => {
    const a = teamMemberActions({ ...base, isPlatform: true });
    for (const check of Object.values(a)) {
      expect(check).toMatchObject({ ok: false, code: "platform" });
    }
  });

  it("cuenta que usa otras empresas → se puede quitar y cambiar el rol, NO resetear la contraseña", () => {
    const a = teamMemberActions({ ...base, otherOrganizations: 2 });
    expect(a.remove.ok).toBe(true);
    expect(a.changeRole.ok).toBe(true);
    expect(a.resetPassword).toMatchObject({ ok: false, code: "shared_account" });
  });

  it("último propietario → ni quitar ni degradar", () => {
    const a = teamMemberActions({ ...base, role: "owner", ownerCount: 1 });
    expect(a.remove).toMatchObject({ ok: false, code: "last_owner" });
    expect(a.changeRole).toMatchObject({ ok: false, code: "last_owner" });
    expect(a.resetPassword.ok).toBe(true);
  });

  it("otro propietario con dos en la empresa → se puede degradar o quitar", () => {
    const a = teamMemberActions({ ...base, role: "owner", ownerCount: 2 });
    expect(a.remove.ok && a.changeRole.ok).toBe(true);
  });
});
