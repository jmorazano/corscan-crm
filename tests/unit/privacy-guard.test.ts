import { describe, expect, it } from "vitest";
import { PRIVACY_FALLBACK, stripUnknownContactData } from "@/lib/privacy-guard";

/**
 * 025 (AC3.3): el agente solo puede repetir datos de contacto que le dimos
 * en el turno. Lo que no sale del contexto, no sale del agente. Y la guarda
 * no puede romper los números legítimos (precios, fechas, códigos, enlaces).
 */

const CORPUS = [
  "CONOCIMIENTO DEL NEGOCIO: Email: atencion@distritoinmobiliario.com.ar · Oficina 351 422-1100",
  "[HERRAMIENTA] - MLA1500000001 | Depto | $ 850.000 | https://departamento.mercadolibre.com.ar/MLA-1500000001-x",
  "CLIENTE: mi dni es 30123456",
].join("\n");

const guard = (text: string, extra: string[] = []) =>
  stripUnknownContactData(text, { corpus: CORPUS, extraPhones: extra });

describe("guarda de privacidad", () => {
  it("saca un teléfono inventado con su oración y deja el resto", () => {
    const r = guard("Claro, te ayudo con eso. Llamala a Marta al 351 555-1234, ella tiene las llaves.");
    expect(r.replaced).toBe(true);
    expect(r.text).toBe("Claro, te ayudo con eso.");
    expect(r.removed).toEqual(["351 555-1234"]);
  });

  it("si no queda nada útil, frase segura", () => {
    const r = guard("+54 9 351 555 9999");
    expect(r.text).toBe(PRIVACY_FALLBACK);
  });

  it("emails: solo los del contexto", () => {
    expect(guard("Escribinos a atencion@distritoinmobiliario.com.ar y te respondemos.").replaced).toBe(false);
    const r = guard("Tu consulta la ve Juan. Escribile a juan.perez@gmail.com y listo, te contesta hoy mismo.");
    expect(r.replaced).toBe(true);
    expect(r.text).toBe("Tu consulta la ve Juan.");
  });

  it("deja pasar los números del contexto y el teléfono del propio contacto", () => {
    expect(guard("La oficina es el 351 422-1100.").replaced).toBe(false);
    expect(guard("Te llamo al 5493511234567 en un rato.", ["5493511234567"]).replaced).toBe(false);
    expect(guard("Confirmo tu DNI 30.123.456 para la reserva.").replaced).toBe(false);
  });

  it("no toca precios, superficies, fechas, códigos ni enlaces", () => {
    const ok = [
      "Sale $ 850.000 por mes más expensas de $ 45.000.",
      "La casa está a USD 140000 y tiene 1.500 m² de terreno.",
      "El valor es 150.000.000 pesos.",
      "Del 2026-10-09 al 2026-10-11 tengo lugar.",
      "Mirá la ficha MLA1500000001 acá: https://departamento.mercadolibre.com.ar/MLA-1500000001-x",
      "Podés venir el jueves de 10 a 18.",
    ];
    for (const t of ok) expect(guard(t).replaced, t).toBe(false);
  });

  it("un DNI/CBU ajeno también se saca aunque tenga puntos", () => {
    const r = guard("El DNI del propietario es 25.987.654, por si lo necesitás. ¿Te ayudo con algo más de la propiedad?");
    expect(r.replaced).toBe(true);
    expect(r.text).toBe("¿Te ayudo con algo más de la propiedad?");
  });
});
