import { describe, expect, it } from "vitest";
import { normalizeContactName } from "@/lib/contact-name";
import { canOverwriteContactName } from "@/lib/history-import";

/** 021 (FR-009): el modelo propone el nombre, esto decide. */
describe("normalizeContactName", () => {
  it.each([
    ["Santiago", "Santiago"],
    ["  Cecilia   Tarres  ", "Cecilia Tarres"],
    ["Mi nombre es Santiago Pintos", "Santiago Pintos"],
    ["me llamo Denise", "Denise"],
    ["Soy Teresa.", "Teresa"],
    ["Nombre: Martín", "Martín"],
    ["María José de la Fuente", "María José de la Fuente"],
    ["O'Connor", "O'Connor"],
    ["Jean-Luc", "Jean-Luc"],
  ])("acepta %s", (raw, esperado) => {
    expect(normalizeContactName(raw)).toBe(esperado);
  });

  it("no cambia las mayúsculas del apellido", () => {
    expect(normalizeContactName("van der Berg")).toBe("van der Berg");
    expect(normalizeContactName("McDonald")).toBe("McDonald");
  });

  it.each([
    ["", "vacío"],
    ["A", "una sola letra"],
    ["3516882234", "un teléfono"],
    ["Santiago 2", "con dígitos"],
    ["$300.000", "un importe"],
    ["https://altosdecalamuchita.com", "una URL"],
    ["santi@mail.com", "un email"],
    ["Quiero reservar una cabaña para el fin de semana largo", "una oración"],
    ["🏔️", "un emoji suelto"],
    ["...", "puntuación suelta"],
  ])("descarta %s (%s)", (raw) => {
    expect(normalizeContactName(raw)).toBeNull();
  });

  it("descarta lo que no es un string", () => {
    expect(normalizeContactName(42)).toBeNull();
    expect(normalizeContactName(null)).toBeNull();
    expect(normalizeContactName({ nombre: "Ana" })).toBeNull();
  });

  it("corta un nombre absurdamente largo", () => {
    expect(normalizeContactName("A".repeat(80))).toBeNull();
  });
});

/** 021 (FR-008): lo que cargó una persona del equipo manda. */
describe("canOverwriteContactName", () => {
  const base = { phone: "5493511234567", consentSource: null, nameEditedAt: null };

  it("un contacto sin nombre propio se puede renombrar", () => {
    expect(canOverwriteContactName({ ...base, name: "5493511234567" })).toBe(true);
    expect(canOverwriteContactName({ ...base, name: "   " })).toBe(true);
  });

  it("el nombre del perfil de WhatsApp se puede reemplazar", () => {
    expect(
      canOverwriteContactName({ ...base, name: "Santi 🏔️", consentSource: "inbound" })
    ).toBe(true);
  });

  it("un import o un alta manual NO se pisan", () => {
    expect(canOverwriteContactName({ ...base, name: "Juan Pérez", consentSource: "import" })).toBe(
      false
    );
    expect(canOverwriteContactName({ ...base, name: "Juan Pérez", consentSource: "manual" })).toBe(
      false
    );
    expect(canOverwriteContactName({ ...base, name: "Juan Pérez", consentSource: "api" })).toBe(
      false
    );
  });

  it("un nombre EDITADO A MANO no se pisa, aunque el contacto haya nacido de un entrante", () => {
    // Regresión del agujero de 017: `consent_source` seguía diciendo
    // 'inbound' después de que el operador corrigiera el nombre, y la sync
    // de la agenda del celular se lo pisaba igual.
    expect(
      canOverwriteContactName({
        ...base,
        name: "Santiago Pintos (dueño)",
        consentSource: "inbound",
        nameEditedAt: new Date(),
      })
    ).toBe(false);
  });
});
