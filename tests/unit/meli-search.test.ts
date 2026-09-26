import { describe, expect, it } from "vitest";
import type { ListingRecord } from "@/lib/meli/listing";
import {
  formatPrice,
  inventorySummary,
  normalizeCurrency,
  operationFromAsk,
  resolveListing,
  searchListings,
} from "@/lib/meli/search";

/**
 * 025 (plan D5): búsqueda PURA sobre el snapshot. Los casos salen de cómo
 * escribe la gente en Córdoba: «depto», «Nueva Cordoba» sin tilde, «hasta
 * 900 mil» sin moneda (alquiler → pesos), «comprar» → venta.
 */

function l(p: Partial<ListingRecord> & { itemId: string; title: string }): ListingRecord {
  return {
    categoryId: null,
    operation: null,
    propertyType: null,
    price: null,
    currency: null,
    rooms: null,
    bedrooms: null,
    bathrooms: null,
    parking: null,
    coveredArea: null,
    totalArea: null,
    neighborhood: null,
    city: "Córdoba",
    state: "Córdoba",
    addressLine: null,
    permalink: `https://departamento.mercadolibre.com.ar/${p.itemId}`,
    thumbnail: null,
    features: [],
    description: null,
    mlUpdatedAt: new Date("2026-09-01T00:00:00Z"),
    ...p,
  };
}

const ALL: ListingRecord[] = [
  l({ itemId: "MLA1", title: "Depto 2 dorm General Paz", operation: "alquiler", propertyType: "Departamento", price: 850000, currency: "ARS", bedrooms: 2, rooms: 3, neighborhood: "General Paz", features: ["Apto mascotas: Sí"] }),
  l({ itemId: "MLA2", title: "Depto 1 dorm Nueva Córdoba", operation: "alquiler", propertyType: "Departamento", price: 620000, currency: "ARS", bedrooms: 1, rooms: 2, neighborhood: "Nueva Córdoba" }),
  l({ itemId: "MLA3", title: "Casa 3 dorm Alta Córdoba", operation: "alquiler", propertyType: "Casa", price: 1200000, currency: "ARS", bedrooms: 3, neighborhood: "Alta Córdoba", features: ["Patio"] }),
  l({ itemId: "MLA4", title: "Depto venta General Paz", operation: "venta", propertyType: "Departamento", price: 95000, currency: "USD", bedrooms: 2, neighborhood: "General Paz" }),
  l({ itemId: "MLA5", title: "Casa venta Cofico", operation: "venta", propertyType: "Casa", price: 140000, currency: "USD", bedrooms: 3, neighborhood: "Cofico" }),
  l({ itemId: "MLA7", title: "Depto 2 dorm General Paz con pileta", operation: "alquiler", propertyType: "Departamento", price: 1100000, currency: "ARS", bedrooms: 2, neighborhood: "General Paz", features: ["Pileta"], mlUpdatedAt: new Date("2026-09-10T00:00:00Z") }),
  l({ itemId: "MLA8", title: "Terreno en venta Villa Allende", operation: "venta", propertyType: "Lote", price: 60000, currency: "USD", neighborhood: "Villa Allende" }),
];

describe("searchListings", () => {
  it("alquiler + depto + barrio + dormitorios + tope sin moneda (pesos, la dominante del alquiler)", () => {
    const out = searchListings(ALL, {
      operation: "alquilar",
      property_type: "depto",
      zone: "general paz",
      bedrooms_min: 2,
      price_max: 900000,
    });
    expect(out.results.map((r) => r.itemId)).toEqual(["MLA1"]);
    expect(out.priceCurrency).toBe("ARS");
  });

  it("zona sin tildes y con prefijo «barrio»", () => {
    expect(searchListings(ALL, { zone: "barrio nueva cordoba" }).results.map((r) => r.itemId)).toEqual(["MLA2"]);
  });

  it("comprar → venta; precio en dólares explícito", () => {
    const out = searchListings(ALL, { operation: "comprar", price_max: 100000, currency: "dólares" });
    expect(out.results.map((r) => r.itemId).sort()).toEqual(["MLA4", "MLA8"]);
    expect(out.priceCurrency).toBe("USD");
  });

  it("un dato que la publicación no trae la excluye (no se inventan dormitorios)", () => {
    expect(searchListings(ALL, { bedrooms_min: 1, operation: "venta" }).results.map((r) => r.itemId)).not.toContain("MLA8");
  });

  it("texto libre sobre título, características y descripción", () => {
    expect(searchListings(ALL, { query: "pileta" }).results.map((r) => r.itemId)).toEqual(["MLA7"]);
  });

  it("sin coincidencias: dice qué pasaría soltando cada filtro", () => {
    const out = searchListings(ALL, { operation: "alquiler", zone: "general paz", price_max: 500000 });
    expect(out.total).toBe(0);
    expect(out.relaxations).toEqual([{ without: "price_max", count: 2 }]);
  });

  it("ordena por precio si hay filtro de precio; si no, lo más reciente primero", () => {
    const byPrice = searchListings(ALL, { operation: "alquiler", price_max: 2000000 });
    expect(byPrice.results.map((r) => r.itemId)).toEqual(["MLA2", "MLA1", "MLA7", "MLA3"]);
    const recent = searchListings(ALL, { operation: "alquiler", property_type: "departamento" });
    expect(recent.results[0]!.itemId).toBe("MLA7");
  });

  it("devuelve como mucho 5 y el total real", () => {
    const out = searchListings(ALL, {});
    expect(out.results).toHaveLength(5);
    expect(out.total).toBe(ALL.length);
  });
});

describe("resolveListing", () => {
  it("por id (con o sin guion), por enlace o por un pedazo único del título", () => {
    expect(resolveListing(ALL, "MLA-7")).toBeNull(); // menos de 6 dígitos: no es un id
    const withLongIds = [l({ itemId: "MLA1500000001", title: "Depto luminoso centro" })];
    expect(resolveListing(withLongIds, "MLA-1500000001")?.itemId).toBe("MLA1500000001");
    expect(resolveListing(withLongIds, "mla1500000001")?.itemId).toBe("MLA1500000001");
    expect(resolveListing(withLongIds, "https://departamento.mercadolibre.com.ar/MLA1500000001")?.itemId).toBe(
      "MLA1500000001"
    );
    expect(resolveListing(ALL, "Casa venta Cofico")?.itemId).toBe("MLA5");
    expect(resolveListing(ALL, "depto")).toBeNull(); // ambiguo
  });
});

describe("resumen del inventario y formatos", () => {
  it("cuenta por operación y tipo, con rango de precios y barrios", () => {
    const inv = inventorySummary(ALL);
    const alquiler = inv.byOperation.find((o) => o.operation === "alquiler")!;
    expect(alquiler.count).toBe(4);
    expect(alquiler.types[0]).toEqual({ type: "Departamento", count: 3 });
    expect(alquiler.priceRange).toBe("$ 620.000 a $ 1.200.000");
    expect(inv.zones[0]).toEqual({ zone: "General Paz", count: 3 });
  });

  it("formatPrice, normalizeCurrency y operationFromAsk", () => {
    expect(formatPrice(850000, "ARS")).toBe("$ 850.000");
    expect(formatPrice(95000, "USD")).toBe("USD 95.000");
    expect(normalizeCurrency("U$S")).toBe("USD");
    expect(normalizeCurrency("pesos")).toBe("ARS");
    expect(operationFromAsk("quiero comprar")).toBe("venta");
    expect(operationFromAsk("alquiler temporario")).toBe("alquiler_temporario");
  });
});
