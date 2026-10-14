import { describe, expect, it } from "vitest";
import {
  appendToField,
  MAX_CHANGES_PER_TURN,
  PROFILE_APPEND_MAX,
  TrainerAction,
} from "@/server/ai/trainer-actions";

/** 015 (D6): contrato de acciones del entrenador. */
describe("TrainerAction", () => {
  it("reply válido", () => {
    expect(TrainerAction.safeParse({ action: "reply", text: "Dale" }).success).toBe(true);
  });

  it("apply con los cinco tipos de cambio", () => {
    const r = TrainerAction.safeParse({
      action: "apply",
      reply: "Listo",
      changes: [
        { op: "kb_add", kind: "qa", question: "¿Precio?", answer: "150 mil" },
        { op: "kb_add", kind: "block", content: "Horario 9 a 18" },
        { op: "kb_update", id: "kb_abc123", answer: "200 mil" },
        { op: "kb_delete", id: "kb_abc123" },
        { op: "profile_set", field: "name", value: "Ari" },
        { op: "profile_append", field: "tone", text: "No usar emojis." },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("apply sin reply vale (el servidor confirma con los resúmenes); sin cambios no", () => {
    expect(
      TrainerAction.safeParse({ action: "apply", changes: [{ op: "kb_delete", id: "kb_x1" }] })
        .success
    ).toBe(true);
    expect(TrainerAction.safeParse({ action: "apply", reply: "x", changes: [] }).success).toBe(
      false
    );
  });

  it("más de MAX_CHANGES_PER_TURN → inválido", () => {
    const changes = Array.from({ length: MAX_CHANGES_PER_TURN + 1 }, () => ({
      op: "kb_delete",
      id: "kb_x1",
    }));
    expect(TrainerAction.safeParse({ action: "apply", reply: "x", changes }).success).toBe(false);
  });

  it("id sin prefijo kb_ → inválido; campo no apendeable → inválido", () => {
    expect(
      TrainerAction.safeParse({
        action: "apply",
        reply: "x",
        changes: [{ op: "kb_delete", id: "tpl_x1" }],
      }).success
    ).toBe(false);
    expect(
      TrainerAction.safeParse({
        action: "apply",
        reply: "x",
        changes: [{ op: "profile_append", field: "name", text: "Ari" }],
      }).success
    ).toBe(false);
  });

  it("acciones del agente de clientes NO son válidas acá (handoff, move_stage)", () => {
    expect(TrainerAction.safeParse({ action: "handoff" }).success).toBe(false);
    expect(TrainerAction.safeParse({ action: "move_stage", stage: "x" }).success).toBe(false);
  });
});

describe("normalizeTrainerOutput (tolerancia a salidas casi correctas)", () => {
  it("cambio suelto con action=op (lo que devolvió el modelo en producción) → apply", () => {
    const r = TrainerAction.parse({
      action: "kb_add",
      kind: "qa",
      question: "¿Qué equipos utilizan?",
      answer: "DJI Matrice 400 con LiDAR L3.",
    });
    expect(r.action).toBe("apply");
    if (r.action !== "apply") return;
    expect(r.changes).toEqual([
      { op: "kb_add", kind: "qa", question: "¿Qué equipos utilizan?", answer: "DJI Matrice 400 con LiDAR L3." },
    ]);
    expect(r.reply).toBeUndefined();
  });
  it("cambio suelto con op y text → apply con reply", () => {
    const r = TrainerAction.parse({ op: "kb_delete", id: "kb_abc1", text: "Borrado." });
    expect(r).toEqual({ action: "apply", changes: [{ op: "kb_delete", id: "kb_abc1" }], reply: "Borrado." });
  });
  it("changes sin action → apply; reply/text intercambiados se aceptan", () => {
    expect(TrainerAction.parse({ changes: [{ op: "kb_delete", id: "kb_x1" }], reply: "ok" }).action).toBe("apply");
    expect(TrainerAction.parse({ action: "reply", reply: "hola" })).toEqual({ action: "reply", text: "hola" });
    const a = TrainerAction.parse({ action: "apply", text: "ok", changes: [{ op: "kb_delete", id: "kb_x1" }] });
    expect(a.action === "apply" && a.reply).toBe("ok");
  });
  it("profile_append suelto conserva `text` como contenido de la regla (producción 13-oct-2026)", () => {
    // Lo que devolvió el modelo tres veces seguidas: sin sobre `apply`, con
    // `action` = op. Antes el normalizador se llevaba `text` como `reply` y
    // el esquema fallaba con `changes.0.text Required`.
    const rule =
      "Si el cliente no quiere agendar la demo, pedile un nombre de negocio ficticio para configurar la cuenta de prueba, y pasa la conversación a atención humana para crear el acceso.";
    const r = TrainerAction.parse({ action: "profile_append", field: "escalationRules", text: rule });
    expect(r).toEqual({
      action: "apply",
      changes: [{ op: "profile_append", field: "escalationRules", text: rule }],
    });
  });
  it("profile_append suelto con reply aparte → reply es la respuesta, text la regla", () => {
    const r = TrainerAction.parse({
      op: "profile_append",
      field: "tone",
      text: "No usar emojis.",
      reply: "Anotado.",
    });
    expect(r).toEqual({
      action: "apply",
      changes: [{ op: "profile_append", field: "tone", text: "No usar emojis." }],
      reply: "Anotado.",
    });
  });
  it("una regla larga (reescritura de la instrucción del dueño) entra hasta PROFILE_APPEND_MAX", () => {
    const long = "x".repeat(1500);
    expect(
      TrainerAction.safeParse({ action: "profile_append", field: "instructions", text: long }).success
    ).toBe(true);
    expect(
      TrainerAction.safeParse({
        action: "profile_append",
        field: "instructions",
        text: "x".repeat(PROFILE_APPEND_MAX + 1),
      }).success
    ).toBe(false);
  });
  it("lista de cambios pelada → apply", () => {
    const r = TrainerAction.parse([
      { op: "kb_delete", id: "kb_x1" },
      { op: "profile_append", field: "tone", text: "Breve." },
    ]);
    expect(r.action).toBe("apply");
    if (r.action !== "apply") return;
    expect(r.changes).toHaveLength(2);
    expect(TrainerAction.safeParse([]).success).toBe(false);
    expect(TrainerAction.safeParse([{ foo: 1 }]).success).toBe(false);
  });
  it("basura sigue siendo inválida", () => {
    expect(TrainerAction.safeParse({ action: "banana" }).success).toBe(false);
    expect(TrainerAction.safeParse("texto").success).toBe(false);
  });
});

describe("appendToField", () => {
  it("agrega una línea con viñeta", () => {
    expect(appendToField("Amable y breve", "No usar emojis.")).toBe(
      "Amable y breve\n- No usar emojis."
    );
  });
  it("sobre vacío arranca con viñeta", () => {
    expect(appendToField(null, "- Tuteá al cliente")).toBe("- Tuteá al cliente");
  });
  it("no duplica una línea ya presente (case-insensitive)", () => {
    const cur = "Amable\n- No usar emojis.";
    expect(appendToField(cur, "no usar emojis.")).toBe(cur);
  });
});
