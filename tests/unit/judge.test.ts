import { beforeEach, describe, expect, it, vi } from "vitest";

const chatJson = vi.fn();
const getAiConfig = vi.fn();

vi.mock("@/lib/ai", () => ({
  chatJson: (...args: unknown[]) => chatJson(...args),
}));

vi.mock("@/server/ai/credentials", () => ({
  getAiConfig: (...args: unknown[]) => getAiConfig(...args),
}));

import { computeScore, judgeCase } from "@/server/lab/judge";

const ORG_CONFIG = {
  token: "sk-or-de-la-empresa",
  model: "modelo-agente",
  judgeModel: "modelo-juez",
};

describe("judgeCase (FR-032, config por empresa US3)", () => {
  beforeEach(() => {
    chatJson.mockReset();
    getAiConfig.mockReset();
    getAiConfig.mockResolvedValue(ORG_CONFIG);
  });

  it("veredicto válido → done, con la config DE LA EMPRESA y opts.judge", async () => {
    chatJson.mockResolvedValue({
      ok: true,
      data: { veredicto: "verde", hallazgos: [] },
      raw: "{}",
    });
    const outcome = await judgeCase({
      organizationId: "org_1",
      personaKey: "comprador_decidido",
      transcript: [{ role: "cliente", text: "hola" }],
      kbText: "kb",
      behaviorText: "b",
    });
    expect(outcome.status).toBe("done");
    // la config se resuelve por la organización plumbeada
    expect(getAiConfig).toHaveBeenCalledWith("org_1");
    // chatJson recibe la config resuelta y usa el modelo del juez (opts.judge)
    expect(chatJson.mock.calls[0]![0]).toEqual(ORG_CONFIG);
    expect(chatJson.mock.calls[0]![3]).toMatchObject({ judge: true });
  });

  it("salida inválida tras reintentos internos → judge_failed (no lanza)", async () => {
    chatJson.mockResolvedValue({
      ok: false,
      error: "invalid_output",
      detail: "no cumple el esquema (raw=...)",
    });
    const outcome = await judgeCase({
      organizationId: "org_1",
      personaKey: "fuera_de_kb",
      transcript: [],
      kbText: "",
      behaviorText: "",
    });
    expect(outcome.status).toBe("judge_failed");
  });

  it("empresa sin config (borrada a mitad de corrida) → judge_failed SIN llamar al proveedor", async () => {
    getAiConfig.mockResolvedValue(null);
    const outcome = await judgeCase({
      organizationId: "org_1",
      personaKey: "curioso",
      transcript: [],
      kbText: "",
      behaviorText: "",
    });
    expect(outcome.status).toBe("judge_failed");
    expect(chatJson).not.toHaveBeenCalled();
  });
});

describe("computeScore (FR-033: judge_failed excluido del denominador)", () => {
  it("pondera verde=1, amarillo=0.5, rojo=0", () => {
    const score = computeScore([
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "amarillo" },
      { status: "done", veredicto: "rojo" },
    ]);
    expect(score).toBe(50); // (1 + 0.5 + 0) / 3 = 0.5
  });

  it("judge_failed NO cuenta en el denominador", () => {
    const score = computeScore([
      { status: "done", veredicto: "verde" },
      { status: "done", veredicto: "verde" },
      { status: "judge_failed", veredicto: null },
    ]);
    expect(score).toBe(100); // 2/2, no 2/3
  });

  it("todo judge_failed → sin score (null)", () => {
    expect(
      computeScore([{ status: "judge_failed", veredicto: null }])
    ).toBeNull();
  });

  it("6 verdes → 100; 6 rojos → 0", () => {
    const verdes = Array(6).fill({ status: "done", veredicto: "verde" });
    const rojos = Array(6).fill({ status: "done", veredicto: "rojo" });
    expect(computeScore(verdes)).toBe(100);
    expect(computeScore(rojos)).toBe(0);
  });
});
