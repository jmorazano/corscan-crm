import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isEmailReservedForOperator,
  isSuperAdminEmail,
  superAdminEmails,
} from "@/server/auth/super-admin";

/** D1/FR-001: rol de plataforma por SUPER_ADMIN_EMAILS + FR-016 anti-escalación. */

afterEach(() => vi.unstubAllEnvs());

describe("isSuperAdminEmail", () => {
  it("sin SUPER_ADMIN_EMAILS no hay super admin", () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "");
    expect(isSuperAdminEmail("duena@agencia.com")).toBe(false);
    expect(superAdminEmails()).toEqual([]);
  });

  it("parsea la lista separada por comas con espacios", () => {
    vi.stubEnv(
      "SUPER_ADMIN_EMAILS",
      " duena@agencia.com , respaldo@agencia.com ,"
    );
    expect(superAdminEmails()).toEqual([
      "duena@agencia.com",
      "respaldo@agencia.com",
    ]);
    expect(isSuperAdminEmail("respaldo@agencia.com")).toBe(true);
  });

  it("compara case-insensitive y con trim", () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "Duena@Agencia.com");
    expect(isSuperAdminEmail("duena@agencia.com")).toBe(true);
    expect(isSuperAdminEmail("  DUENA@AGENCIA.COM  ")).toBe(true);
  });

  it("email ausente o no listado → false", () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "duena@agencia.com");
    expect(isSuperAdminEmail(null)).toBe(false);
    expect(isSuperAdminEmail(undefined)).toBe(false);
    expect(isSuperAdminEmail("otro@empresa.com")).toBe(false);
  });
});

describe("isEmailReservedForOperator (FR-016)", () => {
  it("un operador común NO puede usar un email de super admin", () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "duena@agencia.com");
    expect(
      isEmailReservedForOperator("duena@agencia.com", "owner@empresa.com")
    ).toBe(true);
  });

  it("un super admin sí puede dar de alta otro email reservado", () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "duena@agencia.com,respaldo@agencia.com");
    expect(
      isEmailReservedForOperator("respaldo@agencia.com", "duena@agencia.com")
    ).toBe(false);
  });

  it("emails no reservados pasan para cualquier operador", () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "duena@agencia.com");
    expect(
      isEmailReservedForOperator("nuevo@empresa.com", "owner@empresa.com")
    ).toBe(false);
  });
});
