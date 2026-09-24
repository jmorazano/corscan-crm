import { describe, expect, it } from "vitest";
import { aiMockCompletion } from "@/server/dev/ai-mock";
import { TRAINER_MARKER } from "@/server/ai/trainer-prompts";
import { TrainerAction } from "@/server/ai/trainer-actions";
import { TRAINER_IMAGE_READ_MARKER } from "@/lib/ai";
import { trainerImageContext } from "@/lib/trainer-image";
import { MOCK_IMAGE_SUMMARY, MOCK_TRAINER_IMAGE_READING } from "@/server/dev/ai-mock";

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
  // 022: imágenes del dueño.
  it("lectura de imagen del entrenador → texto completo con precios; la del cliente → una línea", () => {
    const jpeg = { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } };
    const trainerRead = aiMockCompletion([
      { role: "system", content: `${TRAINER_IMAGE_READ_MARKER} Leés imágenes…` },
      { role: "user", content: [{ type: "text", text: "Leé esta imagen." }, jpeg] },
    ]);
    expect(trainerRead).toBe(MOCK_TRAINER_IMAGE_READING);
    expect(trainerRead).toMatch(/precio/i);
    const clientRead = aiMockCompletion([
      { role: "system", content: "Describís en UNA sola oración…" },
      { role: "user", content: [{ type: "text", text: "¿Qué es esta imagen?" }, jpeg] },
    ]);
    expect(clientRead).toBe(MOCK_IMAGE_SUMMARY);
    const png = aiMockCompletion([
      { role: "system", content: `${TRAINER_IMAGE_READ_MARKER} Leés imágenes…` },
      { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
    ]);
    expect(png).toBe("[SIN_CONTENIDO]");
  });
  it("imagen leída en el turno → kb_add block con lo leído; imagen fallida → pide el texto", () => {
    const leida = trainerImageContext({
      mediaState: "ready",
      mediaSummary: MOCK_TRAINER_IMAGE_READING,
      text: "la lista de este mes",
      error: null,
    })!;
    const a = turn(SYSTEM_EMPTY, leida);
    if (a.action !== "apply") throw new Error("esperaba apply");
    expect(a.changes[0]).toMatchObject({ op: "kb_add", kind: "block" });
    expect((a.changes[0] as { content: string }).content).toContain("Mensura: precio desde $150.000");
    expect((a.changes[0] as { content: string }).content).not.toContain("Epígrafe");
    const fallida = trainerImageContext({
      mediaState: "failed",
      mediaSummary: null,
      text: null,
      error: "No se pudo leer la imagen",
    })!;
    const b = turn(SYSTEM_EMPTY, fallida);
    expect(b.action).toBe("reply");
    if (b.action === "reply") expect(b.text).toMatch(/escrib/i);
  });
  it("no toca el juez ni el agente de clientes", () => {
    const raw = aiMockCompletion([
      { role: "system", content: "Eres el asistente" },
      { role: "user", content: "hola" },
    ]);
    expect(JSON.parse(raw)).toMatchObject({ action: "reply" });
  });
});
