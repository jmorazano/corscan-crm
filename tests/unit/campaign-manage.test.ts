import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Gestión de campañas (007): filtros de la lista (status/q), regla de
 * borrado (solo lo que no está enviando) y DELETE acotado a la organización
 * y guardado por estado.
 */

const whereArgs: unknown[] = [];
let selectRows: Record<string, unknown>[] = [];
let deleteReturning: Record<string, unknown>[] = [];
const deleteCalls: unknown[] = [];

vi.mock("@/lib/db/tenant", () => ({
  scoped: (...args: unknown[]) => {
    whereArgs.push(args);
    return { __scoped: args };
  },
}));

vi.mock("@/lib/env", () => ({ getEnv: () => ({ CAMPAIGN_PACE_MS: 4000 }) }));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(selectRows) }),
      }),
    }),
    delete: () => ({
      where: (where: unknown) => {
        deleteCalls.push(where);
        return { returning: () => Promise.resolve(deleteReturning) };
      },
    }),
  }),
  schema: {
    campaign: {
      id: "campaign.id",
      name: "campaign.name",
      status: "campaign.status",
      organizationId: "campaign.organization_id",
    },
  },
}));

import {
  canDeleteCampaign,
  deleteCampaign,
  likePattern,
  parseCampaignFilters,
} from "@/server/campaigns/manage";

beforeEach(() => {
  whereArgs.length = 0;
  deleteCalls.length = 0;
  selectRows = [];
  deleteReturning = [];
});

describe("parseCampaignFilters", () => {
  it("sin params → todos los estados y sin búsqueda", () => {
    expect(parseCampaignFilters(new URLSearchParams(""))).toEqual({
      statuses: [],
      q: "",
    });
  });

  it("status en lista, dedupe, case-insensitive y valores desconocidos fuera", () => {
    expect(
      parseCampaignFilters(
        new URLSearchParams("status=Draft,running,draft,zzz, paused ")
      ).statuses
    ).toEqual(["draft", "running", "paused"]);
  });

  it("q se recorta y se acota", () => {
    const q = parseCampaignFilters(
      new URLSearchParams(`q=${" ".repeat(3)}${"a".repeat(200)}`)
    ).q;
    expect(q).toBe("a".repeat(80));
  });
});

describe("likePattern", () => {
  it("escapa los comodines de LIKE para buscar literal", () => {
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
  });
});

describe("canDeleteCampaign", () => {
  it.each([
    ["draft", true],
    ["completed", true],
    ["cancelled", true],
    ["running", false],
    ["paused", false],
  ])("%s → %s", (status, expected) => {
    expect(canDeleteCampaign(status)).toBe(expected);
  });
});

describe("deleteCampaign", () => {
  it("borra un borrador acotado a la org y guardado por estado", async () => {
    selectRows = [{ id: "cmp_1", name: "Promo", status: "draft" }];
    deleteReturning = [{ id: "cmp_1" }];
    await expect(deleteCampaign("org_1", "cmp_1")).resolves.toEqual({
      id: "cmp_1",
      name: "Promo",
    });
    expect(deleteCalls).toHaveLength(1);
    for (const args of whereArgs) {
      expect((args as unknown[])[1]).toBe("org_1");
    }
  });

  it("de otra org (o inexistente) → not_found sin borrar", async () => {
    await expect(deleteCampaign("org_2", "cmp_1")).rejects.toMatchObject({
      code: "not_found",
    });
    expect(deleteCalls).toHaveLength(0);
  });

  it("en curso/pausada → in_progress sin borrar (cancelar primero)", async () => {
    for (const status of ["running", "paused"]) {
      selectRows = [{ id: "cmp_1", name: "Promo", status }];
      await expect(deleteCampaign("org_1", "cmp_1")).rejects.toMatchObject({
        code: "in_progress",
      });
    }
    expect(deleteCalls).toHaveLength(0);
  });

  it("carrera: se lanzó entre el SELECT y el DELETE → in_progress (0 filas)", async () => {
    selectRows = [{ id: "cmp_1", name: "Promo", status: "draft" }];
    deleteReturning = [];
    await expect(deleteCampaign("org_1", "cmp_1")).rejects.toMatchObject({
      code: "in_progress",
    });
  });
});
