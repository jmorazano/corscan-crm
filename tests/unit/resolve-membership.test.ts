import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * FR-012 (research D6): con más de una membresía, resolveMembership es
 * determinista — siempre gana la más antigua (created_at ASC, id ASC).
 * El stub simula la BD real: sin el ORDER BY correcto devuelve las filas
 * en un orden arbitrario (el del "plan de la query").
 */

type MemberRow = {
  organizationId: string;
  role: string;
  createdAt: number;
  id: string;
};

const state: { rows: MemberRow[]; orderByArgs: unknown[] | null } = {
  rows: [],
  orderByArgs: null,
};

function renderedOrderBy(): string[] {
  return (state.orderByArgs ?? []).map((a) =>
    new PgDialect().sqlToQuery(a as SQL).sql.toLowerCase()
  );
}

function resolveRows(): MemberRow[] {
  const rendered = renderedOrderBy();
  const deterministic =
    rendered.length === 2 &&
    rendered[0]!.includes("created_at") &&
    rendered[0]!.includes("asc") &&
    rendered[1]!.includes("id") &&
    rendered[1]!.includes("asc");
  if (!deterministic) return state.rows; // orden arbitrario (inserción)
  return [...state.rows].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  );
}

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: (...args: unknown[]) => {
              state.orderByArgs = args;
              return {
                limit: (n: number) => Promise.resolve(resolveRows().slice(0, n)),
              };
            },
            limit: (n: number) => Promise.resolve(resolveRows().slice(0, n)),
          }),
        }),
      }),
    }),
  };
});

import { resolveMembership } from "@/server/auth/on-signup";

describe("resolveMembership determinista", () => {
  it("con dos membresías devuelve la más antigua, no la del orden de inserción", async () => {
    state.orderByArgs = null;
    state.rows = [
      // la más NUEVA primero: sin ORDER BY, la BD podría devolver esta
      { organizationId: "org_nueva", role: "member", createdAt: 200, id: "org_b" },
      { organizationId: "org_vieja", role: "owner", createdAt: 100, id: "org_a" },
    ];
    const membership = await resolveMembership("u_1");
    expect(membership).toEqual({
      organizationId: "org_vieja",
      role: "owner",
      createdAt: 100,
      id: "org_a",
    });
    // y el ORDER BY pedido es exactamente created_at ASC, id ASC
    const rendered = renderedOrderBy();
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toContain("created_at");
    expect(rendered[1]).toContain('"id"');
  });

  it("empate de created_at → desempata por id ascendente", async () => {
    state.orderByArgs = null;
    state.rows = [
      { organizationId: "org_z", role: "member", createdAt: 100, id: "org_z9" },
      { organizationId: "org_a", role: "member", createdAt: 100, id: "org_a1" },
    ];
    const membership = await resolveMembership("u_1");
    expect(membership?.organizationId).toBe("org_a");
  });

  it("sin membresías → null", async () => {
    state.orderByArgs = null;
    state.rows = [];
    expect(await resolveMembership("u_1")).toBeNull();
  });
});
