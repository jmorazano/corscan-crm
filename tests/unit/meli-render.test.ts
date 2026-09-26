import { describe, expect, it } from "vitest";
import type { ListingRecord } from "@/lib/meli/listing";
import { searchListings } from "@/lib/meli/search";
import {
  LISTINGS_MARKER,
  clientSummaryFor,
  renderListingDetail,
  renderListingsSection,
  renderSearchResult,
  visitNote,
} from "@/lib/meli/render";

/**
 * 025: textos que ve el modelo. Lo que importa fijar: el marcador de la
 * sección, las reglas (no inventar, no dar la dirección, no confirmar
 * visitas sin agenda), que el resultado lleve el enlace y NUNCA la dirección
 * exacta, y que la descripción del aviso vaya encerrada como DATO.
 */

const L: ListingRecord = {
  itemId: "MLA1500000001",
  title: "Departamento en alquiler 2 dormitorios General Paz",
  categoryId: "MLA1472",
  operation: "alquiler",
  propertyType: "Departamento",
  price: 850000,
  currency: "ARS",
  rooms: 3,
  bedrooms: 2,
  bathrooms: 1,
  parking: 0,
  coveredArea: 65,
  totalArea: 70,
  neighborhood: "General Paz",
  city: "Córdoba",
  state: "Córdoba",
  addressLine: "Ibarbalz 1100",
  permalink: "https://departamento.mercadolibre.com.ar/MLA-1500000001-depto-_JM",
  thumbnail: null,
  features: ["Expensas: 45000 ARS", "Apto mascotas: Sí"],
  description: "Luminoso, a 3 cuadras de la plaza.",
  mlUpdatedAt: new Date("2026-09-20T12:00:00Z"),
};

const now = new Date("2026-09-26T12:00:00Z");

describe("sección del prompt", () => {
  it("marcador, inventario, reglas y visita por pedido (sin agenda)", () => {
    const s = renderListingsSection({
      listings: [L],
      nickname: "DISTRITO",
      lastSyncAt: new Date("2026-09-26T11:00:00Z"),
      now,
      calendarBookable: false,
    });
    expect(s.startsWith(LISTINGS_MARKER)).toBe(true);
    expect(s).toContain("1 publicaciones activas de la cuenta «DISTRITO», actualizadas hace 1 h");
    expect(s).toContain("- Alquiler: 1 (Departamento 1) · $ 850.000");
    expect(s).toContain("Barrios/zonas: General Paz (1).");
    expect(s).toContain("La dirección exacta NO se da por chat");
    expect(s).toContain('"action":"request_visit"');
    expect(s).not.toContain("book_appointment");
    expect(s).toContain("NUNCA confirmes vos la visita");
  });

  it("con agenda reservable, las visitas van por la agenda", () => {
    const s = renderListingsSection({ listings: [L], nickname: null, lastSyncAt: now, now, calendarBookable: true });
    expect(s).toContain("check_availability");
    expect(s).toContain("book_appointment");
    expect(s).not.toContain('"action":"request_visit"');
  });
});

describe("resultado de búsqueda", () => {
  it("una línea por publicación con precio, barrio, datos y enlace — sin dirección", () => {
    const out = searchListings([L], { operation: "alquiler" });
    const t = renderSearchResult(out, { operation: "alquiler" }, [L]);
    expect(t.startsWith("[HERRAMIENTA] PUBLICACIONES ENCONTRADAS: 1")).toBe(true);
    expect(t).toContain("MLA1500000001");
    expect(t).toContain("$ 850.000");
    expect(t).toContain("General Paz, Córdoba");
    expect(t).toContain("3 amb · 2 dorm · 1 baño · 65 m² cub");
    expect(t).toContain("https://departamento.mercadolibre.com.ar/MLA-1500000001-depto-_JM");
    expect(t).not.toContain("Ibarbalz");
  });

  it("sin coincidencias: lo que hay y la alternativa", () => {
    const filters = { operation: "alquiler", zone: "cofico" };
    const t = renderSearchResult(searchListings([L], filters), filters, [L]);
    expect(t).toContain("SIN COINCIDENCIAS");
    expect(t).toContain("en otros barrios (1)");
    expect(t).toContain("Lo que hay publicado: Alquiler 1");
    expect(t).toContain("No inventes propiedades");
  });
});

describe("ficha", () => {
  it("descripción en valla con nonce y sin dirección", () => {
    const t = renderListingDetail(L);
    expect(t).toContain("[HERRAMIENTA] FICHA MLA1500000001");
    expect(t).toContain("la dirección exacta NO se da por chat");
    expect(t).toMatch(/=== NOTAS DEL PROVEEDOR [0-9a-f]{16} ===/);
    expect(t).toContain("Luminoso, a 3 cuadras de la plaza.");
    expect(t).not.toContain("Ibarbalz");
  });
});

describe("respaldo al cliente y nota de visita", () => {
  it("clientSummary: hasta 3 con enlace; nada sin enlaces", () => {
    const s = clientSummaryFor([L, L, L, L])!;
    expect(s.match(/https:\/\//g)).toHaveLength(3);
    expect(s).toContain("¿Querés coordinar una visita a alguna?");
    expect(clientSummaryFor([{ ...L, permalink: null }])).toBeNull();
  });

  it("visitNote dice qué propiedad y cuándo", () => {
    expect(visitNote(L, "jueves después de las 18", "MLA1500000001")).toBe(
      "Pidió coordinar visita: Departamento en alquiler 2 dormitorios General Paz (MLA1500000001) https://departamento.mercadolibre.com.ar/MLA-1500000001-depto-_JM — disponibilidad: jueves después de las 18"
    );
    expect(visitNote(null, null, null)).toBe("Pidió coordinar visita: una propiedad (sin especificar)");
  });
});
