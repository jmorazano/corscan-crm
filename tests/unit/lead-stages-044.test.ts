import { describe, expect, it } from "vitest";
import {
  canAutoMove,
  isStaleDays,
  renderStageSection,
  stageAfterReply,
  staleCutoff,
  stageRoles,
  type StageLike,
} from "@/lib/lead-stages";
import { eventText } from "@/lib/conversation-events";
import { AgentAction, isConcreteAvailabilityQuery } from "@/server/ai/actions";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

const STAGES: StageLike[] = [
  { id: "s0", name: "Nuevo", kind: "open", position: 0 },
  { id: "s1", name: "En conversación", kind: "open", position: 1 },
  { id: "s2", name: "Interesado", kind: "open", position: 2 },
  { id: "s3", name: "Cliente", kind: "won", position: 3 },
  { id: "s4", name: "Perdido", kind: "lost", position: 4 },
];
const [nuevo, charla, interesado, cliente, perdido] = STAGES as [
  StageLike,
  StageLike,
  StageLike,
  StageLike,
  StageLike,
];

describe("044 · roles de las etapas", () => {
  it("reconoce las etapas sembradas por rol", () => {
    const r = stageRoles(STAGES);
    expect(r.first?.id).toBe("s0");
    expect(r.talking?.id).toBe("s1");
    expect(r.interested?.id).toBe("s2");
    expect(r.won?.id).toBe("s3");
    expect(r.lost?.id).toBe("s4");
  });

  it("etapas propias: sin la del rol, el rol queda vacío", () => {
    const r = stageRoles([
      { id: "a", name: "Consulta", kind: "open", position: 0 },
      { id: "b", name: "Presupuesto enviado", kind: "open", position: 1 },
      { id: "c", name: "Ganado", kind: "won", position: 2 },
    ]);
    expect(r.first?.id).toBe("a");
    expect(r.talking).toBeUndefined();
    expect(r.interested).toBeUndefined();
    expect(r.won?.id).toBe("c");
    expect(r.lost).toBeUndefined();
  });

  it("la primera etapa nunca es a la vez la de conversación", () => {
    const r = stageRoles([
      { id: "a", name: "En conversación", kind: "open", position: 0 },
      { id: "b", name: "Interesado", kind: "open", position: 1 },
    ]);
    expect(r.first?.id).toBe("a");
    expect(r.talking).toBeUndefined();
  });
});

describe("044 · canAutoMove (solo avanza, salvo perdido)", () => {
  it("avanza entre abiertas y no retrocede", () => {
    expect(canAutoMove(nuevo, charla)).toBe(true);
    expect(canAutoMove(nuevo, interesado)).toBe(true);
    expect(canAutoMove(interesado, charla)).toBe(false);
    expect(canAutoMove(charla, charla)).toBe(false);
  });

  it("perdido solo desde una abierta; cliente nunca sale solo", () => {
    expect(canAutoMove(interesado, perdido)).toBe(true);
    expect(canAutoMove(cliente, perdido)).toBe(false);
    expect(canAutoMove(cliente, interesado)).toBe(false);
  });

  it("cliente desde abierta o perdida", () => {
    expect(canAutoMove(nuevo, cliente)).toBe(true);
    expect(canAutoMove(perdido, cliente)).toBe(true);
  });

  it("de perdido vuelve a una abierta solo si no se dio de baja", () => {
    expect(canAutoMove(perdido, interesado)).toBe(true);
    expect(canAutoMove(perdido, interesado, { optedOut: true })).toBe(false);
  });

  it("sin lead no hay movimiento", () => {
    expect(canAutoMove(null, interesado)).toBe(false);
  });
});

describe("044 · sección del prompt", () => {
  it("dice la etapa actual y el significado de cada una", () => {
    const text = renderStageSection(STAGES, "s1") ?? "";
    expect(text).toContain("Etapa actual: «En conversación».");
    expect(text).toContain("«Interesado»: pidió fechas");
    expect(text).toContain("«Cliente»: compró, reservó o pagó");
    expect(text).toContain('"stage":"<nombre exacto>"');
  });

  it("las etapas propias van por nombre, sin inventarles significado", () => {
    const text =
      renderStageSection(
        [
          { id: "a", name: "Consulta", kind: "open", position: 0 },
          { id: "b", name: "Presupuesto enviado", kind: "open", position: 1 },
        ],
        null
      ) ?? "";
    expect(text).toContain("- «Presupuesto enviado».");
    expect(text).toContain("sin lead todavía");
  });

  it("el prompt del agente usa la sección cuando tiene las etapas completas", () => {
    const profile = {
      name: "Giuliana",
      tone: null,
      instructions: null,
      escalationRules: null,
      greeting: null,
    } as unknown as Parameters<typeof buildAgentSystemPrompt>[0]["profile"];
    const full = buildAgentSystemPrompt({ profile, kb: [], stages: STAGES, currentStageId: "s0" });
    expect(full).toContain("ETAPA DEL LEAD");
    expect(full).toContain("Etapa actual: «Nuevo».");
    const legacy = buildAgentSystemPrompt({ profile, kb: [], stages: [{ name: "Nuevo" }] });
    expect(legacy).toContain("Etapas del pipeline disponibles: Nuevo");
  });
});

describe("044 · la etapa viaja con la acción", () => {
  it("reply, update_lead y las consultas aceptan stage", () => {
    const r = AgentAction.parse({ action: "reply", text: "hola", stage: "Interesado" });
    expect(r.action === "reply" && r.stage).toBe("Interesado");
    const t = AgentAction.parse({ action: "search_stays", check_in: "2026-11-01", stage: "Interesado" });
    expect(t.action === "search_stays" && t.stage).toBe("Interesado");
  });

  it("una etapa con forma rara no tumba el turno", () => {
    const r = AgentAction.parse({ action: "reply", text: "hola", stage: { nombre: "x" } });
    expect(r.action === "reply" && r.stage).toBeUndefined();
  });

  it("consultar con fechas concretas es interés", () => {
    expect(
      isConcreteAvailabilityQuery(
        AgentAction.parse({ action: "search_stays", check_in: "2026-11-01", check_out: "2026-11-03" })
      )
    ).toBe(true);
    expect(
      isConcreteAvailabilityQuery(
        AgentAction.parse({
          action: "search_stays",
          ranges: [{ check_in: "2026-11-01", check_out: "2026-11-03" }],
        })
      )
    ).toBe(true);
    expect(isConcreteAvailabilityQuery(AgentAction.parse({ action: "search_stays", guests: 2 }))).toBe(false);
    expect(isConcreteAvailabilityQuery(AgentAction.parse({ action: "check_availability" }))).toBe(true);
    expect(
      isConcreteAvailabilityQuery(
        AgentAction.parse({
          action: "use_tool",
          tool: "start-booking",
          args: { property: "AC-004", check_in: "2026-11-10", check_out: "2026-11-12" },
        })
      )
    ).toBe(true);
    expect(
      isConcreteAvailabilityQuery(AgentAction.parse({ action: "use_tool", tool: "show-property", args: { property: "AC-004" } }))
    ).toBe(false);
    expect(isConcreteAvailabilityQuery(AgentAction.parse({ action: "reply", text: "hola" }))).toBe(false);
  });
});

describe("044 · días sin respuesta", () => {
  const roles = stageRoles(STAGES);

  it("respondió desde la primera etapa → conversación", () => {
    expect(stageAfterReply(nuevo, roles)?.id).toBe("s1");
  });

  it("perdido por días sin respuesta que vuelve → conversación", () => {
    expect(stageAfterReply(perdido, roles, { staleLost: true })?.id).toBe("s1");
  });

  it("perdido porque dijo que no (o de baja) que escribe «gracias» → se queda", () => {
    expect(stageAfterReply(perdido, roles)).toBeNull();
    expect(stageAfterReply(perdido, roles, { staleLost: true, optedOut: true })).toBeNull();
  });

  it("desde interesado o cliente, responder no cambia la etapa", () => {
    expect(stageAfterReply(interesado, roles)).toBeNull();
    expect(stageAfterReply(cliente, roles)).toBeNull();
  });

  it("sin etapa de conversación, no hay a dónde volver", () => {
    const r = stageRoles([
      { id: "a", name: "Consulta", kind: "open", position: 0 },
      { id: "z", name: "Perdido", kind: "lost", position: 1 },
    ]);
    expect(stageAfterReply({ id: "z", name: "Perdido", kind: "lost", position: 1 }, r, { staleLost: true })).toBeNull();
  });

  it("solo valen 7, 14, 30 o 60 días", () => {
    expect(isStaleDays(7)).toBe(true);
    expect(isStaleDays(60)).toBe(true);
    expect(isStaleDays(10)).toBe(false);
    expect(isStaleDays(null)).toBe(false);
  });

  it("el corte es N días antes de ahora", () => {
    const now = new Date("2026-10-28T12:00:00.000Z");
    expect(staleCutoff(now, 7).toISOString()).toBe("2026-10-21T12:00:00.000Z");
  });

  it("la línea del hilo dice cuántos días y que vuelve si escribe", () => {
    const { text, tone } = eventText(
      { kind: "lead_stale", reason: null, actorName: null, details: { days: 14, stage: "Perdido" } },
      (iso) => iso
    );
    expect(text).toBe(
      "Pasó a Perdido: 14 días sin respuesta. Si vuelve a escribir, pasa solo a la etapa de conversación."
    );
    expect(tone).toBe("neutral");
  });
});
