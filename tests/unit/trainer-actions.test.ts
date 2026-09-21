import { describe, expect, it } from "vitest";
import {
  appendToField,
  MAX_CHANGES_PER_TURN,
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
