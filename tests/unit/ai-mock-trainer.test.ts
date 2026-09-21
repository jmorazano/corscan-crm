import { describe, expect, it } from "vitest";
import { aiMockCompletion } from "@/server/dev/ai-mock";
import { TRAINER_MARKER } from "@/server/ai/trainer-prompts";
import { TrainerAction } from "@/server/ai/trainer-actions";

/** 015: el ai-mock devuelve acciones del entrenador válidas y deterministas. */
function turn(system: string, user: string) {
  const raw = aiMockCompletion([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  const parsed = TrainerAction.parse(JSON.parse(raw));
  return parsed;
}

const SYSTEM_EMPTY = `${TRAINER_MARKER} Sos "Ari"…\nCONOCIMIENTO ACTUAL:\n(vacío)`;
const SYSTEM_WITH_PRICE = `${TRAINER_MARKER} Sos "Ari"…\nCONOCIMIENTO ACTUAL:\n[kb_p1x] P: ¿Cuál es el precio de mensura?\nR: 100 mil`;

describe("ai-mock · entrenador", () => {
  it("precio sin entrada previa → kb_add qa", () => {
    const a = turn(SYSTEM_EMPTY, "cuando pregunten por precio de mensura decí que arranca en 150 mil");
    expect(a.action).toBe("apply");
    if (a.action !== "apply") return;
    expect(a.changes[0]).toMatchObject({ op: "kb_add", kind: "qa" });
    expect((a.changes[0] as { question: string }).question).toContain("mensura");
  });
  it("precio con entrada previa → kb_update de esa id", () => {
    const a = turn(SYSTEM_WITH_PRICE, "el precio de mensura ahora es 200 mil");
    expect(a.action).toBe("apply");
    if (a.action !== "apply") return;
    expect(a.changes[0]).toMatchObject({ op: "kb_update", id: "kb_p1x" });
  });
  it("«no uses emojis» → profile_append tone", () => {
    const a = turn(SYSTEM_EMPTY, "no uses emojis");
    if (a.action !== "apply") throw new Error("esperaba apply");
    expect(a.changes[0]).toMatchObject({ op: "profile_append", field: "tone" });
  });
  it("borrar con ids → kb_delete; sin ids → pregunta", () => {
    const a = turn(SYSTEM_WITH_PRICE, "borrá lo del precio");
    if (a.action !== "apply") throw new Error("esperaba apply");
    expect(a.changes[0]).toMatchObject({ op: "kb_delete", id: "kb_p1x" });
    expect(turn(SYSTEM_EMPTY, "borrá esa entrada").action).toBe("reply");
  });
  it("pregunta → reply sin cambios", () => {
    expect(turn(SYSTEM_EMPTY, "¿qué sabés de mensuras?").action).toBe("reply");
  });
  it("no toca el juez ni el agente de clientes", () => {
    const raw = aiMockCompletion([
      { role: "system", content: "Eres el asistente" },
      { role: "user", content: "hola" },
    ]);
    expect(JSON.parse(raw)).toMatchObject({ action: "reply" });
  });
});
