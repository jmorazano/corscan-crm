import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, renderKb } from "@/server/ai/prompts";
import { KB_LIMITS, WARN_CHARS } from "@/server/kb/service";
import { PROFILE_LIMITS } from "@/server/ai/profile";
import { altos } from "@/server/mcp/profiles/altos";

/**
 * El conocimiento de los agentes de alojamiento es CONFIGURACIÓN, no código:
 * su prueba de verdad es una conversación con un modelo real. Lo que sí se
 * puede fijar acá —y es lo que más cuesta cuando se edita a mano— es que
 * entre en los límites, que no contradiga la sección del conector y que no
 * hard-codee datos que cambian sin avisar.
 *
 * Son dos negocios del mismo dueño sobre el mismo PMS: «Altos de
 * Calamuchita» (sierras) y «Altos de la Ciudad» (departamentos urbanos).
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

function load(file: string): SeedFile {
  return JSON.parse(readFileSync(`scripts/seed/agents/${file}`, "utf8")) as SeedFile;
}

function asEntries(seed: SeedFile) {
  return seed.kb.map((e, i) => ({
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
}

function promptOf(seed: SeedFile): string {
  return buildAgentSystemPrompt({
    profile: {
      id: "ap_1",
      organizationId: "org_test",
      enabled: true,
      name: seed.profile.name,
      tone: seed.profile.tone ?? null,
      instructions: seed.profile.instructions ?? null,
      escalationRules: seed.profile.escalationRules ?? null,
      greeting: seed.profile.greeting ?? null,
      replyDelayMs: null,
      sharedPersonalNumber: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    kb: asEntries(seed),
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
}

const SEEDS = [
  { file: "altos-de-calamuchita.json", agente: "Giuliana", negocio: "Altos de Calamuchita" },
  { file: "altos-de-la-ciudad.json", agente: "Camila", negocio: "Altos de la Ciudad" },
];

describe.each(SEEDS)("seed de $negocio", ({ file, agente, negocio }) => {
  const seed = load(file);

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
    expect(renderKb(asEntries(seed)).length).toBeLessThan(WARN_CHARS);
  });

  it("no hard-codea lo que devuelve el sistema de reservas", () => {
    // Localidades, barrios, tipos y precios cambian sin avisar (016, §12): si
    // se escriben acá, el conocimiento contradice a la herramienta el día que
    // el cliente agrega una unidad o cambia una tarifa.
    const texto = [
      seed.profile.instructions ?? "",
      seed.profile.tone ?? "",
      renderKb(asEntries(seed)),
    ].join("\n");
    for (const lugar of [
      "San Clemente",
      "Potrero de Garay",
      "Santa Rosa de Calamuchita",
      "Villa Yacanto",
      "El Durazno",
      "San Miguel de los Ríos",
      "Nueva Córdoba",
      "Güemes",
      "Alberdi",
    ]) {
      expect(texto).not.toContain(lugar);
    }
    expect(texto).not.toMatch(/\$\s?\d|\b\d[\d.]*\s*pesos\b/i);
  });

  it("conserva el flujo de conversación y las reglas del negocio", () => {
    const prompt = promptOf(seed);
    expect(prompt).toContain(agente);
    expect(prompt).toContain("responsable de reservas");
    expect(prompt).not.toContain(`"${agente}", el asistente`);
    expect(prompt).toContain("saludás y te presentás");
    expect(prompt).toContain("contact_name");
    expect(prompt).toContain(`Mi única función es ayudarte a encontrar alojamiento en ${negocio}`);
    expect(prompt).toContain('{"action":"none"}');
    expect(prompt).toMatch(/modelo de IA|con qué tecnología/i);
    expect(prompt).toContain("Recibí el comprobante");
    expect(prompt).not.toMatch(/te confirmamos la reserva/i);
    expect(prompt).toContain("no se toman reservas");
  });

  it("los pendientes mandan a confirmar con el equipo, no inventan", () => {
    const pendientes = seed.kb.filter(
      (e) => e.kind === "qa" && /confirmás con el equipo y escalá/.test(e.answer)
    );
    expect(pendientes.length).toBeGreaterThan(0);
    for (const e of pendientes) {
      if (e.kind === "qa") expect(e.answer).toContain("No la inventes");
    }
  });
});

describe("las dos empresas no se pisan", () => {
  const sierras = load("altos-de-calamuchita.json");
  const ciudad = load("altos-de-la-ciudad.json");

  it("cada una tiene su propio agente", () => {
    expect(sierras.profile.name).not.toBe(ciudad.profile.name);
  });

  it("el agente urbano no arrastra nada serrano", () => {
    const texto = [ciudad.profile.instructions ?? "", renderKb(asEntries(ciudad))].join("\n");
    for (const serrano of ["arroyo", "fogonero", "quincho", "bajada al río", "sierras de"]) {
      expect(texto.toLowerCase()).not.toContain(serrano.toLowerCase());
    }
  });

  it("la ropa blanca se responde distinto en cada negocio, como en sus catálogos", () => {
    // En las sierras va incluida en el total; en la ciudad el PMS la lista
    // como «Servicio de Ropa Blanca ( Opcional )». Copiar la respuesta de una
    // en la otra sería mentirle al huésped.
    const enSierras = sierras.kb.find(
      (e) => e.kind === "qa" && /ropa blanca/i.test(e.question)
    );
    const enCiudad = ciudad.kb.find((e) => e.kind === "qa" && /ropa blanca/i.test(e.question));
    expect(enSierras && enSierras.kind === "qa" && enSierras.answer).toMatch(/ya está contemplada|incluida/i);
    expect(enCiudad && enCiudad.kind === "qa" && enCiudad.answer).toMatch(/OPCIONAL/);
    expect(enCiudad && enCiudad.kind === "qa" && enCiudad.answer).toMatch(/NO afirmes que está incluida/);
  });

  it("el agente urbano no ofrece el portal de las sierras", () => {
    const texto = renderKb(asEntries(ciudad)) + (ciudad.profile.instructions ?? "");
    // Lo nombra SOLO para deslindarse, nunca para ofrecerlo.
    expect(texto).toContain("no lo menciones, no ofrezcas sus alojamientos");
    expect(texto).toContain("solo con departamentos de la ciudad de Córdoba");
  });
});
