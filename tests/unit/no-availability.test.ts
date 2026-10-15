import { describe, expect, it } from "vitest";

import { noAvailabilityReply } from "@/lib/no-availability";
import { AgentAction } from "@/server/ai/actions";

/**
 * Incidente del 14-oct-2026 en Altos de Calamuchita: dos conversaciones que
 * preguntaban por fechas SIN lugar terminaron en atención humana.
 */
describe("noAvailabilityReply — «no hay lugar» es una respuesta", () => {
  it("sin búsquedas vacías no hay nada que decir", () => {
    expect(noAvailabilityReply([])).toBeNull();
  });

  it("caso real: 6 y 8 personas del 21 al 23 de noviembre, con tipo «Casa»", () => {
    const text = noAvailabilityReply([
      { checkIn: "2026-11-21", checkOut: "2026-11-23", guests: 6, filtered: true },
      { checkIn: "2026-11-21", checkOut: "2026-11-23", guests: 8, filtered: true },
    ]);
    expect(text).toBe(
      "Lamentablemente no tengo disponibilidad con lo que buscás del 21/11 al 23/11 para 6 ni para 8 personas. ¿Querés que te busque otras fechas cercanas?"
    );
  });

  it("ordena y deduplica las cantidades; sin filtros no aclara «con lo que buscás»", () => {
    const text = noAvailabilityReply([
      { checkIn: "2026-11-21", checkOut: "2026-11-23", guests: 10, filtered: false },
      { checkIn: "2026-11-21", checkOut: "2026-11-23", guests: 6, filtered: false },
      { checkIn: "2026-11-21", checkOut: "2026-11-23", guests: 6, filtered: false },
      { checkIn: "2026-11-21", checkOut: "2026-11-23", guests: 8, filtered: false },
    ]);
    expect(text).toBe(
      "Lamentablemente no tengo disponibilidad del 21/11 al 23/11 para 6, 8 ni para 10 personas. ¿Querés que te busque otras fechas cercanas?"
    );
  });

  it("varios rangos de fechas", () => {
    const text = noAvailabilityReply([
      { checkIn: "2026-12-31", checkOut: "2027-01-03", guests: 7, filtered: false },
      { checkIn: "2027-01-03", checkOut: "2027-01-06", guests: 7, filtered: false },
    ]);
    expect(text).toBe(
      "Lamentablemente no tengo disponibilidad del 31/12 al 03/01 para 7 personas ni del 03/01 al 06/01 para 7 personas. ¿Querés que te busque otras fechas?"
    );
  });

  it("sin fechas ni personas conocidas igual arma una frase sin huecos", () => {
    expect(noAvailabilityReply([{ checkIn: "", checkOut: "", guests: null, filtered: false }])).toBe(
      "Lamentablemente no tengo disponibilidad para esas fechas. ¿Querés que te busque otras fechas cercanas?"
    );
  });

  it("nunca promete volver a consultar ni lleva enlaces o importes", () => {
    const text = noAvailabilityReply([
      { checkIn: "2026-11-21", checkOut: "2026-11-23", guests: 8, filtered: false },
    ]) as string;
    expect(text).not.toMatch(/ratito|te confirmo|https?:|\$/i);
  });
});

describe("update_lead sin nota", () => {
  // El JSON exacto que devolvió el modelo en producción (14-oct-2026).
  const raw = {
    action: "update_lead",
    contact_name: "Alejandra",
    reply:
      "Perfecto, Alejandra. La entrada sería el 31 de diciembre de 2026 para 10 personas. ¿Qué fecha de salida tenés pensada?",
  };

  it("ya no rompe el esquema (antes: «note Required» → atención humana)", () => {
    const parsed = AgentAction.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.action === "update_lead") {
      expect(parsed.data.reply).toContain("¿Qué fecha de salida");
      expect(parsed.data.note).toBeUndefined();
    }
  });

  it("con nota sigue igual", () => {
    expect(AgentAction.safeParse({ ...raw, note: "10 personas, 31/12" }).success).toBe(true);
  });
});
