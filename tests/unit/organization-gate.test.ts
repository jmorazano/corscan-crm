import { describe, expect, it } from "vitest";
import { isOrganizationPathDenied } from "@/lib/auth/organization-gate";

/**
 * FR-013 (research D5): gate ALLOWLIST del plugin organization. Cada path
 * mutante enumerado se verifica UNO POR UNO, y la semántica default-deny
 * cubre endpoints que el plugin agregue a futuro.
 */

const DENIED_PATHS = [
  "/organization/create",
  "/organization/update",
  "/organization/delete",
  "/organization/set-active",
  "/organization/invite-member",
  "/organization/accept-invitation",
  "/organization/cancel-invitation",
  "/organization/reject-invitation",
  "/organization/remove-member",
  "/organization/update-member-role",
  "/organization/leave",
];

describe("gate ALLOWLIST del plugin organization", () => {
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
