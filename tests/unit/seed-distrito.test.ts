import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, PERSONAL_NUMBER_MARKER, PRIVACY_HEADING, renderKb } from "@/server/ai/prompts";
import { KB_LIMITS, WARN_CHARS } from "@/server/kb/service";
import { PROFILE_LIMITS } from "@/server/ai/profile";
import { renderListingsSection } from "@/lib/meli/render";

/**
 * 025 (US5): «Javier», el agente de Distrito Inmobiliario. Es configuración:
 * su prueba de verdad es una conversación. Lo que se fija acá es lo que se
 * rompe editando a mano: límites, que habla en primera persona SIN negar ser
 * un asistente, que no hard-codea propiedades ni precios (salen de Mercado
 * Libre), que no trae teléfonos de nadie, y que el número personal va
 * encendido.
 */

type Seed = {
  profile: {
    name: string;
    tone?: string | null;
    instructions?: string | null;
    escalationRules?: string | null;
    greeting?: string | null;
    sharedPersonalNumber?: boolean;
  };
  kb: ({ kind: "qa"; question: string; answer: string } | { kind: "block"; content: string })[];
  _revisar: string[];
};

const seed = JSON.parse(
  readFileSync("scripts/seed/agents/distrito-inmobiliario.json", "utf8")
) as Seed;

const entries = seed.kb.map((e, i) => ({
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

const texto = [seed.profile.instructions, seed.profile.tone, seed.profile.escalationRules, renderKb(entries)].join(
  "\n"
);

describe("seed de Javier (Distrito Inmobiliario)", () => {
  it("entra en los límites del perfil y del conocimiento", () => {
    expect(seed.profile.name).toBe("Javier");
    expect((seed.profile.tone ?? "").length).toBeLessThanOrEqual(PROFILE_LIMITS.tone);
    expect((seed.profile.instructions ?? "").length).toBeLessThanOrEqual(PROFILE_LIMITS.instructions);
    expect((seed.profile.escalationRules ?? "").length).toBeLessThanOrEqual(PROFILE_LIMITS.escalationRules);
    for (const e of seed.kb) {
      if (e.kind === "qa") {
        expect(e.question.length).toBeLessThanOrEqual(KB_LIMITS.question);
        expect(e.answer.length).toBeLessThanOrEqual(KB_LIMITS.answer);
      } else {
        expect(e.content.length).toBeLessThanOrEqual(KB_LIMITS.content);
      }
    }
    expect(renderKb(entries).length).toBeLessThan(WARN_CHARS);
  });

  it("número personal encendido y el bar/lo personal fuera del alcance", () => {
    expect(seed.profile.sharedPersonalNumber).toBe(true);
    expect(texto).toMatch(/bar/);
    expect(texto).toContain("acción none");
  });

  it("primera persona, pero jamás niega ser un asistente", () => {
    expect(seed.profile.instructions).toContain("Hablás en primera persona, como Javier");
    expect(seed.profile.instructions).toContain("no lo niegues");
    expect(texto).not.toMatch(/nunca (digas|admitas|reconozcas) que sos (un )?(bot|asistente|ia)/i);
  });

  it("no inventa: sin precios, sin propiedades, sin teléfonos, sin asesoramiento legal", () => {
    expect(texto).not.toMatch(/\$\s?\d|\bUSD\s?\d|\b\d[\d.]*\s*(pesos|d[oó]lares)\b/i);
    expect(texto).not.toMatch(/\bMLA-?\d{6,}/);
    expect(texto).not.toMatch(/\+?\d[\d\s-]{8,}\d/);
    expect(texto).toContain("No des opinión ni asesoramiento legal");
    expect(texto).toContain("No inventás requisitos");
    // La dirección de la oficina está sin confirmar: queda en _revisar.
    expect(texto).not.toContain("Sarmiento");
    expect(seed._revisar.join("\n")).toContain("Sarmiento 1009");
  });

  it("el prompt completo lleva publicaciones, número personal y privacidad", () => {
    const prompt = buildAgentSystemPrompt({
      profile: {
        id: "agp_1",
        organizationId: "org_test",
        enabled: true,
        name: seed.profile.name,
        tone: seed.profile.tone ?? null,
        instructions: seed.profile.instructions ?? null,
        escalationRules: seed.profile.escalationRules ?? null,
        greeting: seed.profile.greeting ?? null,
        replyDelayMs: null,
        sharedPersonalNumber: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      kb: entries,
      stages: [{ name: "Nuevo" }, { name: "Interesado" }],
      listingsSection: renderListingsSection({
        listings: [],
        nickname: "DISTRITO",
        lastSyncAt: new Date(),
        now: new Date(),
        calendarBookable: false,
      }),
      sharedPersonalNumber: true,
    });
    expect(prompt).toContain(PERSONAL_NUMBER_MARKER);
    expect(prompt).toContain(PRIVACY_HEADING);
    expect(prompt).toContain('"action":"request_visit"');
    // Un prompt de WhatsApp tiene que seguir siendo razonable.
    expect(prompt.length).toBeLessThan(20_000);
  });
});
