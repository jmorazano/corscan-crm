import { describe, expect, it } from "vitest";
import { detectPriceMention, safePriceReply, stripPrices } from "@/lib/price-guard";

/**
 * 021: el negocio no escribe importes por WhatsApp. Los falsos positivos son
 * el modo de falla caro — el agente escribe números legítimos todo el rato.
 */
describe("detectPriceMention · lo que SÍ es un precio", () => {
  const CON_PRECIO = [
    "El total es $600.000 por las tres noches.",
    "Sale $ 300000 la noche.",
    "Son AR$ 45.000 de seña.",
    "El valor es ARS 300000.",
    "Te sale 450.000 pesos en total.",
    "La seña son 60000 pesos argentinos.",
    "Son trescientos mil pesos por la estadía.",
    "Ciento cincuenta mil pesos la noche.",
    "Te lo dejo en 300 lucas.",
    "US$ 200 por noche.",
  ];
  it.each(CON_PRECIO)("detecta: %s", (frase) => {
    expect(detectPriceMention(frase).mentions).toBe(true);
  });

  it("reporta el fragmento original para el registro", () => {
    expect(detectPriceMention("El total es $600.000 por las noches.").match).toBe("$600.000");
  });
});

describe("detectPriceMention · lo que NO es un precio", () => {
  const SIN_PRECIO = [
    "Para 4 personas del 12/10 al 15/10, tengo 3 opciones.",
    "Tiene 3 dormitorios y 2 baños, hasta 8 personas.",
    "La propiedad es la AC-006, en Villa del Cóndor.",
    "Son 5 noches, del 20 al 25 de octubre.",
    "Los valores los ves en el enlace de la propiedad.",
    "El precio y la seña figuran en la ficha, discriminados.",
    "Mi WhatsApp es el 3516882234 por si necesitás algo.",
    "El check-in es a partir de las 14:00.",
    "Está a 300 metros del arroyo.",
    "Entran hasta 10 personas, con 4 habitaciones.",
    "La estadía mínima es de 2 noches.",
    "Queda en la Ruta 5, km 12.",
  ];
  it.each(SIN_PRECIO)("no dispara: %s", (frase) => {
    expect(detectPriceMention(frase).mentions).toBe(false);
  });

  it("un texto vacío no dispara", () => {
    expect(detectPriceMention("").mentions).toBe(false);
    expect(detectPriceMention(null).mentions).toBe(false);
  });
});

describe("stripPrices", () => {
  it("un texto limpio pasa intacto y sin marcar", () => {
    const t = "Para el 12/10 al 15/10 y 4 personas tengo la Casa del Arroyo, en Villa del Cóndor.";
    expect(stripPrices(t)).toEqual({ text: t, replaced: false, match: null });
  });

  it("saca la oración del precio y conserva el resto", () => {
    const out = stripPrices(
      "Para el 10 al 12 de octubre tengo la Cabaña Fronda, con 2 dormitorios y quincho. El total es $600.000. ¿Te la reservo para verla?",
      { link: "https://altosdecalamuchita.com/alquiler/fronda" }
    );
    expect(out.replaced).toBe(true);
    expect(out.text).toContain("Cabaña Fronda");
    expect(out.text).toContain("¿Te la reservo para verla?");
    expect(out.text).not.toContain("600.000");
    expect(out.text).toContain("https://altosdecalamuchita.com/alquiler/fronda");
  });

  it("limpia renglón por renglón una lista de opciones con precios", () => {
    const out = stripPrices(
      [
        "Tengo dos opciones para esas fechas:",
        "• Casa Camiare — 3 hab, Potrero de Garay. Total $900.000.",
        "• Cabaña Fronda — 2 hab, San Clemente. Total $600.000.",
        "Mirá las fotos en el enlace.",
      ].join("\n")
    );
    expect(out.text).not.toMatch(/\$/);
    expect(out.text).toContain("Tengo dos opciones");
    expect(out.text).toContain("Mirá las fotos en el enlace.");
  });

  it("el punto de los miles NO parte la oración (regresión)", () => {
    // Bug encontrado conduciendo el E2E: «$600.000» se cortaba en «$600» +
    // «.000», se descartaba la primera mitad y el mensaje salía a WhatsApp
    // con un «.000).» colgado en el medio.
    const out = stripPrices(
      "- Casa Camiare (AC-004) — hasta 8 personas, 3 hab, Camiare, Potrero de Garay. Arrollo a 300 metros. Valor INTERNO: total $600.000 ($300.000/noche, seña $60.000). https://altosdecalamuchita.com/x"
    );
    // Nada de restos del número partido: ni «.000» ni «000)».
    expect(out.text).not.toMatch(/\.000|\b000\)/);
    expect(out.text).toContain("Casa Camiare (AC-004)");
    expect(out.text).toContain("Arrollo a 300 metros.");
    expect(out.text).toContain("https://altosdecalamuchita.com/x");
    expect(out.text).not.toContain("Valor INTERNO");
  });

  it("no agrega un segundo enlace si el mensaje que queda ya tiene uno", () => {
    const out = stripPrices(
      "Te dejo la Casa del Arroyo, en Villa del Cóndor. Sale $900.000 en total. https://altosdecalamuchita.com/x",
      { link: "https://altosdecalamuchita.com/buscar" }
    );
    expect(out.text.match(/https?:\/\//g)).toHaveLength(1);
    expect(out.text).toContain("https://altosdecalamuchita.com/x");
  });

  it("si todo el mensaje era el precio, manda la frase segura con el enlace", () => {
    const out = stripPrices("$600.000.", {
      link: "https://altosdecalamuchita.com/buscar?in=2026-10-10",
    });
    expect(out.replaced).toBe(true);
    expect(out.text).toBe(safePriceReply("https://altosdecalamuchita.com/buscar?in=2026-10-10"));
  });

  it("sin enlace usable no inventa uno", () => {
    const out = stripPrices("Son $300.000.", { link: "javascript:alert(1)" });
    expect(out.text).not.toContain("javascript");
    expect(out.text).toContain("desde el enlace");
  });

  it("el reemplazo no vuelve a disparar la guarda (nada de bucles)", () => {
    for (const link of ["https://altosdecalamuchita.com/x", null]) {
      expect(detectPriceMention(safePriceReply(link)).mentions).toBe(false);
    }
  });

  it("puede decir cuál es la más económica mientras no diga cuánto sale", () => {
    const t = "La más económica de las tres es la Suite La Mansa, en San Clemente.";
    expect(stripPrices(t).replaced).toBe(false);
  });
});
