import { describe, expect, it } from "vitest";
import { applyTagOps, sameTagSet } from "@/lib/tags";
import {
  prepareTagRequest,
  summarizeTagging,
  tagRejection,
  type TaggedRow,
} from "@/lib/assistants/tagging";

/**
 * 046: etiquetar contactos desde Claude. Qué etiquetas se aceptan y un
 * resultado que se deshace exacto.
 */

function run(contacts: Record<string, string[]>, add: string[], remove: string[]): TaggedRow[] {
  return Object.entries(contacts).map(([id, before]) => ({ id, before, after: applyTagOps(before, { add, remove }) }));
}

describe("tagRejection", () => {
  it("rechaza lo que parece un dato del cliente", () => {
    expect(tagRejection("juan@gmail.com")).toMatch(/correo/);
    expect(tagRejection("@juanperez")).toMatch(/correo|usuario/);
    expect(tagRejection("351 555-1234")).toMatch(/teléfono/);
    expect(tagRejection("dni-30.123.456")).toMatch(/documento/);
    expect(tagRejection("tel 3515551234")).toMatch(/teléfono/);
    expect(tagRejection("0351-555-1234")).toMatch(/teléfono/);
    expect(tagRejection("2026-1234567")).toMatch(/teléfono/);
  });

  it("acepta rótulos del negocio, con fechas y números cortos", () => {
    for (const tag of ["vip", "interesado-lidar", "meta-ads-2026-10", "campaña 2026", "lote 12", "cliente-2025", "evento-2026-10-29", "202610"]) {
      expect(tagRejection(tag)).toBeNull();
    }
  });
});

describe("prepareTagRequest", () => {
  it("sanea, deduplica y separa lo rechazado", () => {
    const r = prepareTagRequest(["  VIP ", "vip", "x@y.com"], ["Frío"]);
    expect(r.add).toEqual(["vip"]);
    expect(r.remove).toEqual(["frío"]);
    expect(r.rejected).toEqual([{ tag: "x@y.com", reason: expect.any(String) }]);
  });

  it("la misma etiqueta en agregar y quitar se agrega", () => {
    expect(prepareTagRequest(["vip"], ["vip", "frio"])).toMatchObject({ add: ["vip"], remove: ["frio"] });
  });
});

describe("summarizeTagging", () => {
  const contacts = {
    ct_a: ["frio"],
    ct_b: ["vip", "frio"],
    ct_c: [],
    ct_full: Array.from({ length: 20 }, (_, i) => `t${i}`),
  };

  it("por etiqueta, solo los contactos que la ganaron o la perdieron", () => {
    const s = summarizeTagging(run(contacts, ["vip"], ["frio"]), { add: ["vip"], remove: ["frio"] });
    expect(s.added).toEqual([{ tag: "vip", contactIds: ["ct_a", "ct_c"] }]);
    expect(s.removed).toEqual([{ tag: "frio", contactIds: ["ct_a", "ct_b"] }]);
    expect(s.full).toEqual(["ct_full"]);
    expect(s.updated).toBe(3);
  });

  it("repetir la misma operación no cambia nada", () => {
    const first = run(contacts, ["vip"], ["frio"]);
    const again = Object.fromEntries(first.map((r) => [r.id, [...r.after]]));
    const s = summarizeTagging(run(again, ["vip"], ["frio"]), { add: ["vip"], remove: ["frio"] });
    expect(s.updated).toBe(0);
    expect(s.added).toEqual([]);
    expect(s.removed).toEqual([]);
  });

  it("deshacer con lo informado deja cada contacto como estaba", () => {
    const rows = run(contacts, ["vip"], ["frio"]);
    const s = summarizeTagging(rows, { add: ["vip"], remove: ["frio"] });
    const state = new Map(rows.map((r) => [r.id, [...r.after]]));
    for (const g of s.added) for (const id of g.contactIds) state.set(id, applyTagOps(state.get(id)!, { remove: [g.tag] }));
    for (const g of s.removed) for (const id of g.contactIds) state.set(id, applyTagOps(state.get(id)!, { add: [g.tag] }));
    for (const [id, before] of Object.entries(contacts)) {
      expect(sameTagSet(state.get(id)!, before)).toBe(true);
    }
  });
});
