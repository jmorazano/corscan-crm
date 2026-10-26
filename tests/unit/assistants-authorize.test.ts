import { describe, expect, it } from "vitest";
import {
  decideWorkspaceAccess,
  resolveWorkspaceRef,
  workspaceDeniedText,
} from "@/lib/assistants/authorize";

/** 040 (research D7, FR-007): acceso por empresa en cada llamada. */
describe("decideWorkspaceAccess", () => {
  it.each([
    [{ inGrant: true, enabled: true, role: "owner" }, "ok"],
    [{ inGrant: false, enabled: true, role: "owner" }, "not_authorized"],
    [{ inGrant: true, enabled: false, role: "owner" }, "disabled"],
    [{ inGrant: true, enabled: true, role: "member" }, "not_owner"],
    [{ inGrant: true, enabled: true, role: null }, "not_owner"],
    [{ inGrant: true, enabled: false, role: null }, "not_owner"],
    [{ inGrant: false, enabled: false, role: null }, "not_authorized"],
  ] as const)("%j → %s", (facts, expected) => {
    expect(decideWorkspaceAccess(facts)).toBe(expected);
  });
});

describe("resolveWorkspaceRef", () => {
  const ws = [
    { id: "org_a", name: "Altos de Calamuchita", slug: "altos-de-calamuchita" },
    { id: "org_b", name: "Altos de la Ciudad", slug: "altos-de-la-ciudad" },
  ];

  it("por id, nombre o slug", () => {
    const all = new Set(["org_a", "org_b"]);
    expect(resolveWorkspaceRef("org_b", ws, all)).toEqual({ ok: true, workspace: ws[1] });
    expect(resolveWorkspaceRef("altos de calamuchita", ws, all)).toEqual({
      ok: true,
      workspace: ws[0],
    });
    expect(resolveWorkspaceRef("ALTOS-DE-LA-CIUDAD", ws, all)).toEqual({
      ok: true,
      workspace: ws[1],
    });
  });

  it("omitido: solo si hay UNA activa", () => {
    expect(resolveWorkspaceRef(undefined, ws, new Set(["org_a"]))).toEqual({
      ok: true,
      workspace: ws[0],
    });
    expect(resolveWorkspaceRef("", ws, new Set(["org_a", "org_b"]))).toEqual({
      ok: false,
      reason: "ambiguous",
    });
  });

  it("desconocida (o de otra conexión) no se distingue de inexistente", () => {
    expect(resolveWorkspaceRef("org_zzz", ws, new Set())).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("textos en castellano con el nombre", () => {
    expect(workspaceDeniedText("disabled", "Altos de la Ciudad")).toMatch(
      /desactivado en «Altos de la Ciudad».*Ajustes → Asistentes/
    );
    expect(workspaceDeniedText("not_authorized", null)).toMatch(/No tengo acceso/);
  });
});
