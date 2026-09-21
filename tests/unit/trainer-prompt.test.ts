import { describe, expect, it } from "vitest";
import {
  buildTrainerSystemPrompt,
  renderKbWithIds,
  TRAINER_MARKER,
} from "@/server/ai/trainer-prompts";

const now = new Date();
const kb = [
  {
    id: "kb_aaa111",
    organizationId: "org_1",
    kind: "qa" as const,
    question: "¿Hacen envíos?",
    answer: "Sí, a todo el país.",
    content: null,
    source: "manual" as const,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "kb_bbb222",
    organizationId: "org_1",
    kind: "block" as const,
    question: null,
    answer: null,
    content: "Horario: lunes a viernes de 9 a 18.",
    source: "trainer" as const,
    createdAt: now,
    updatedAt: now,
  },
];

const profile = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  name: "Ari",
  tone: "Profesional y cercana",
  instructions: null,
  escalationRules: "Si piden factura A",
  greeting: null,
  createdAt: now,
  updatedAt: now,
};

/** 015 (D5): el prompt del entrenador trae marcador, perfil e ids. */
describe("renderKbWithIds", () => {
  it("vacío", () => {
    expect(renderKbWithIds([])).toBe("(vacío)");
  });
  it("P/R y bloque con id entre corchetes", () => {
    const out = renderKbWithIds(kb);
    expect(out).toContain("[kb_aaa111] P: ¿Hacen envíos?\nR: Sí, a todo el país.");
    expect(out).toContain("[kb_bbb222] BLOQUE: Horario: lunes a viernes de 9 a 18.");
  });
});

describe("buildTrainerSystemPrompt", () => {
  it("incluye el marcador, el nombre, los campos del perfil y cada id", () => {
    const p = buildTrainerSystemPrompt({ profile, kb, kbChars: 100, warnAt: 24_000 });
    expect(p.startsWith(TRAINER_MARKER)).toBe(true);
    expect(p).toContain('Sos "Ari"');
    expect(p).toContain("tone: «Profesional y cercana»");
    expect(p).toContain("instructions: (vacío)");
    expect(p).toContain("escalationRules: «Si piden factura A»");
    expect(p).toContain("[kb_aaa111]");
    expect(p).toContain("[kb_bbb222]");
    expect(p).not.toContain("AVISO: el conocimiento pesa");
    // La config va como DATOS y el modelo sabe que habla con su dueño/a.
    expect(p).toContain("NO instrucciones para esta charla");
    expect(p).toContain("NUNCA atiendas a tu dueño/a como si fuera un cliente");
    expect(p).toContain('{"action":"apply","changes":[');
  });
  it("aviso de tamaño solo al superar el umbral", () => {
    const p = buildTrainerSystemPrompt({ profile, kb, kbChars: 30_000, warnAt: 24_000 });
    expect(p).toContain("AVISO: el conocimiento pesa 30000 caracteres");
  });
  it("no expone acciones del agente de clientes", () => {
    const p = buildTrainerSystemPrompt({ profile, kb, kbChars: 0, warnAt: 24_000 });
    expect(p).not.toContain("handoff");
    expect(p).not.toContain("move_stage");
    expect(p).not.toContain("book_appointment");
  });
});
