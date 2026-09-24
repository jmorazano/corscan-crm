import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, renderKb } from "@/server/ai/prompts";
import { KB_LIMITS, WARN_CHARS } from "@/server/kb/service";
import { PROFILE_LIMITS } from "@/server/ai/profile";
import { altos } from "@/server/mcp/profiles/altos";

/**
 * El conocimiento del agente de «Altos de Calamuchita» es CONFIGURACIÓN, no
 * código: su prueba de verdad es una conversación con un modelo real. Lo que
 * sí se puede fijar acá —y es lo que más cuesta cuando se edita a mano— es
 * que entre en los límites, que no contradiga la sección del conector y que
 * no hard-codee datos que cambian sin avisar.
 */
type SeedFile = {
  profile: {
    name: string;
    tone?: string;
    instructions?: string;
    escalationRules?: string;
    greeting?: string;
  };
  kb: (
    | { kind: "qa"; question: string; answer: string }
    | { kind: "block"; content: string }
  )[];
};

const seed = JSON.parse(
  readFileSync("scripts/seed/agents/altos-de-calamuchita.json", "utf8")
) as SeedFile;

const kbEntries = seed.kb.map((e, i) => ({
  id: `kb_${i}`,
  organizationId: "org_test",
  kind: e.kind,
  question: e.kind === "qa" ? e.question : null,
  answer: e.kind === "qa" ? e.answer : null,
  content: e.kind === "block" ? e.content : null,
  source: "manual" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

describe("seed del agente de Altos de Calamuchita", () => {
  it("entra en los límites del perfil y del knowledge base", () => {
    expect(seed.profile.name.length).toBeLessThanOrEqual(PROFILE_LIMITS.name);
    expect((seed.profile.tone ?? "").length).toBeLessThanOrEqual(PROFILE_LIMITS.tone);
    expect((seed.profile.instructions ?? "").length).toBeLessThanOrEqual(
      PROFILE_LIMITS.instructions
    );
    expect((seed.profile.escalationRules ?? "").length).toBeLessThanOrEqual(
      PROFILE_LIMITS.escalationRules
    );
    expect((seed.profile.greeting ?? "").length).toBeLessThanOrEqual(PROFILE_LIMITS.greeting);
    for (const e of seed.kb) {
      if (e.kind === "qa") {
        expect(e.question.length).toBeLessThanOrEqual(KB_LIMITS.question);
        expect(e.answer.length).toBeLessThanOrEqual(KB_LIMITS.answer);
      } else {
        expect(e.content.length).toBeLessThanOrEqual(KB_LIMITS.content);
      }
    }
    // El KB entero entra al prompt en cada turno.
    expect(renderKb(kbEntries).length).toBeLessThan(WARN_CHARS);
  });

  it("no hard-codea lo que devuelve el sistema de reservas", () => {
    // Localidades, tipos y precios cambian sin avisar (016, §12): si se
    // escriben acá, el conocimiento contradice a la herramienta el día que
    // el cliente agrega una localidad o cambia una tarifa.
    const texto = [
      seed.profile.instructions ?? "",
      seed.profile.tone ?? "",
      renderKb(kbEntries),
    ].join("\n");
    for (const localidad of [
      "San Clemente",
      "Potrero de Garay",
      "Santa Rosa de Calamuchita",
      "Villa Yacanto",
      "El Durazno",
      "San Miguel de los Ríos",
    ]) {
      expect(texto).not.toContain(localidad);
    }
    // Ningún importe ni tarifa.
    expect(texto).not.toMatch(/\$\s?\d|\b\d[\d.]*\s*pesos\b/i);
  });

  it("conserva las reglas que el cliente le había enseñado al agente anterior", () => {
    const prompt = buildAgentSystemPrompt({
      profile: {
        id: "ap_1",
        organizationId: "org_test",
        enabled: true,
        name: seed.profile.name,
        tone: seed.profile.tone ?? null,
        instructions: seed.profile.instructions ?? null,
        escalationRules: seed.profile.escalationRules ?? null,
        greeting: seed.profile.greeting ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      kb: kbEntries,
      stages: [{ name: "Nuevo" }, { name: "Interesado" }],
      mcpSection: altos.renderSection({
        catalog: null,
        now: new Date("2026-10-01T12:00:00Z"),
        status: "connected",
        agentToolsEnabled: true,
        timezone: "America/Argentina/Cordoba",
      }),
      mcpOverridesKb: true,
    });

    // Identidad y rol propio (nunca «asistente»).
    expect(prompt).toContain("Giuliana");
    expect(prompt).toContain("responsable de reservas");
    expect(prompt).not.toContain('"Giuliana", el asistente');
    // Saludo, presentación y nombre antes de mostrar opciones.
    expect(prompt).toContain("saludás y te presentás");
    expect(prompt).toContain("contact_name");
    // Off-topic: una despedida y después silencio.
    expect(prompt).toContain("Mi única función es ayudarte a encontrar alojamiento");
    expect(prompt).toContain('{"action":"none"}');
    // Hermetismo.
    expect(prompt).toMatch(/modelo de IA|con qué tecnología/i);
    // Comprobantes: acusar recibo sin dar el pago por hecho.
    expect(prompt).toContain("Recibí el comprobante");
    expect(prompt).not.toMatch(/te confirmamos la reserva/i);
    // La reserva se completa en el sitio.
    expect(prompt).toContain("no se toman reservas");
  });

  it("los pendientes mandan a confirmar con el equipo, no inventan", () => {
    const pendientes = seed.kb.filter(
      (e) => e.kind === "qa" && /confirmás con el equipo y escalá/.test(e.answer)
    );
    // Hay pendientes declarados y cada uno dice explícitamente que no se
    // inventa. Cuando el cliente responda, se reemplazan por la respuesta
    // real y este número baja.
    expect(pendientes.length).toBeGreaterThan(0);
    for (const e of pendientes) {
      if (e.kind === "qa") expect(e.answer).toContain("No la inventes");
    }
  });
});
