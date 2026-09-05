import { describe, expect, it, vi } from "vitest";

/**
 * US1 (FR-005/FR-006): la lógica PURA del import — normalización + dedup
 * interno (planImportRows) y merge conservador (buildContactMerge). El
 * ejecutor con BD se ejercita en el guion E2E us-cc-1.
 */

vi.mock("@/lib/db", () => ({
  getDb: () => {
    throw new Error("las funciones puras no tocan la BD");
  },
  schema: {},
}));

import {
  buildContactMerge,
  planImportRows,
} from "@/server/contacts-import";

const NOW = new Date("2026-09-05T12:00:00Z");

describe("planImportRows — normalización y dedup interno", () => {
  it("convergencia AR: 3 formatos del mismo número = 1 pendiente + 2 updated", () => {
    const plan = planImportRows([
      { phone: "0351 15 688 2200", name: "Uno", tags: ["a"] },
      { phone: "+54 351 688 2200", name: "Uno bis", tags: ["b"] },
      { phone: "5493516882200", tags: ["c"] },
    ]);
    expect(plan.pending).toHaveLength(1);
    expect(plan.internalDuplicates).toBe(2);
    const row = plan.pending[0]!;
    expect(row.waId).toBe("5493516882200");
    expect(row.name).toBe("Uno"); // la primera fila gana
    expect(row.tags.sort()).toEqual(["a", "b", "c"]);
    expect(plan.invalid).toHaveLength(0);
  });

  it("inválidos con motivo e índice, sin abortar el resto", () => {
    const plan = planImportRows([
      { phone: "ABC" },
      { phone: "   " },
      { phone: "+54 9 351 688 2201", name: "Válido" },
    ]);
    expect(plan.pending).toHaveLength(1);
    expect(plan.invalid).toEqual([
      { index: 0, phone: "ABC", reason: "telefono_invalido" },
      { index: 1, phone: "   ", reason: "telefono_vacio" },
    ]);
  });

  it("tags se sanean (trim, lower, únicas)", () => {
    const plan = planImportRows([
      { phone: "+54 9 351 688 2202", tags: [" VIP ", "vip", "", "Clientes-2025"] },
    ]);
    expect(plan.pending[0]!.tags.sort()).toEqual(["clientes-2025", "vip"]);
  });
});

describe("buildContactMerge — merge conservador (idempotente)", () => {
  const base = {
    phone: "5493516882200",
    name: "5493516882200", // jamás editado: igual al teléfono
    notes: null,
    tags: ["vieja"],
    consentSource: null as string | null,
  };
  const row = {
    index: 0,
    waId: "5493516882200",
    name: "Cliente Uno",
    tags: ["nueva"],
    notes: "hola",
  };

  it("completa nombre no editado, notas vacías, une tags y estampa consent", () => {
    const set = buildContactMerge(base, row, NOW);
    expect(set).toMatchObject({
      name: "Cliente Uno",
      notes: "hola",
      consentSource: "import",
      consentAt: NOW,
    });
    expect((set!.tags as string[]).sort()).toEqual(["nueva", "vieja"]);
  });

  it("JAMÁS pisa un nombre editado por el operador ni notas existentes ni consent previo", () => {
    const edited = {
      ...base,
      name: "Nombre Editado",
      notes: "notas del operador",
      consentSource: "inbound",
      tags: ["vieja"],
    };
    const set = buildContactMerge(edited, row, NOW);
    expect(set?.name).toBeUndefined();
    expect(set?.notes).toBeUndefined();
    expect(set?.consentSource).toBeUndefined();
    expect((set?.tags as string[]).sort()).toEqual(["nueva", "vieja"]);
  });

  it("re-import idéntico → null (nada que cambiar)", () => {
    const alreadyMerged = {
      ...base,
      name: "Cliente Uno",
      notes: "hola",
      consentSource: "import",
      tags: ["nueva", "vieja"],
    };
    expect(buildContactMerge(alreadyMerged, row, NOW)).toBeNull();
  });
});
