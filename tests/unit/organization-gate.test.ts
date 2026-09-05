import { describe, expect, it } from "vitest";
import { isOrganizationPathDenied } from "@/lib/auth/organization-gate";

/**
 * FR-013 (research D5): gate ALLOWLIST del plugin organization. Cada path
 * mutante enumerado se verifica UNO POR UNO, y la semántica default-deny
 * cubre endpoints que el plugin agregue a futuro.
 */

// La MISMA constante que consume el hook: si la lista real divergiera de lo
// testeado, este import lo hace imposible (antes el test verificaba una copia).
import { DENIED_ORGANIZATION_PATHS } from "@/lib/auth/organization-gate";

const DENIED_PATHS = DENIED_ORGANIZATION_PATHS;

describe("gate ALLOWLIST del plugin organization", () => {
  it("la lista enumerada de research D5 sigue completa (11 paths)", () => {
    expect(DENIED_ORGANIZATION_PATHS).toHaveLength(11);
    expect(DENIED_ORGANIZATION_PATHS).toContain("/organization/invite-member");
  });

  for (const path of DENIED_PATHS) {
    it(`niega ${path}`, () => {
      expect(isOrganizationPathDenied(path)).toBe(true);
    });
  }

  it("default-deny: un endpoint nuevo del plugin nace negado", () => {
    expect(isOrganizationPathDenied("/organization/create-team")).toBe(true);
    expect(isOrganizationPathDenied("/organization/list")).toBe(true);
  });

  it("no toca los paths ajenos al plugin organization", () => {
    expect(isOrganizationPathDenied("/sign-in/email")).toBe(false);
    expect(isOrganizationPathDenied("/sign-up/email")).toBe(false);
    expect(isOrganizationPathDenied("/change-password")).toBe(false);
    expect(isOrganizationPathDenied("/get-session")).toBe(false);
  });
});
