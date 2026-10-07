import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 032: la barrera de escritura y la sección del prompt de las herramientas
 * genéricas. `calls.ts` (la única puerta a la red) se simula: acá se prueba
 * QUÉ llega a esa puerta y qué no.
 */

const callGuarded = vi.fn();
const lastWriteAttempt = vi.fn();
const toolMemory = vi.fn();

vi.mock("@/server/mcp/calls", () => ({
  callGuarded: (...args: unknown[]) => callGuarded(...args),
  lastWriteAttempt: (...args: unknown[]) => lastWriteAttempt(...args),
  toolMemory: (...args: unknown[]) => toolMemory(...args),
  UNCERTAIN_WRITE_CODES: new Set(["timeout", "http_error", "bad_payload", "internal_error"]),
}));

import {
  DYNAMIC_TOOLS_HEADING,
  executeDynamicTool,
  loadDynamicTools,
  renderConnectorForTrainer,
  renderDynamicSection,
  type DynamicToolsContext,
} from "@/server/mcp/dynamic-tools";
import type { McpIntegration } from "@/server/mcp/integration";
import { altos } from "@/server/mcp/profiles/altos";
import { generic } from "@/server/mcp/profiles";
import { effectiveTools, toolSignature, type StoredTool } from "@/lib/mcp/tool-policy";
import { makeForeignFence } from "@/server/mcp/sanitize";

function stored(t: Omit<StoredTool, "signature">): StoredTool {
  return { ...t, signature: toolSignature(t) };
}

const START = stored({
  name: "start-booking",
  title: "Iniciar una reserva",
  description: "Abre una reserva en preparación.",
  readOnly: true,
  inputSchema: {
    type: "object",
    properties: {
      property: { type: "string" },
      check_in: { type: "string" },
      check_out: { type: "string" },
      guests: { type: "integer" },
      conversation_id: { type: ["string", "null"] },
    },
    required: ["property", "check_in", "check_out", "guests"],
  },
  annotations: { readOnlyHint: true },
});
const CONFIRM = stored({
  name: "confirm-booking",
  title: "Registrar la reserva",
  description: "Registra la reserva y devuelve payment_url.",
  readOnly: false,
  inputSchema: {
    type: "object",
    properties: { draft_id: { type: "string" }, confirmed: { type: "boolean" } },
    required: ["draft_id", "confirmed"],
  },
  annotations: { readOnlyHint: false, idempotentHint: false },
});
const SEARCH = stored({ name: "check-availability", description: "Busca.", readOnly: true });

function integration(over: Partial<McpIntegration> = {}, approveWrite = true): McpIntegration {
  const policy = approveWrite
    ? { "confirm-booking": { enabled: true, signature: CONFIRM.signature!, by: "u", at: "x" } }
    : null;
  return {
    id: "mcp_1",
    organizationId: "org_1",
    profileKey: "altos_de_calamuchita",
    profile: altos,
    label: "Altos de Calamuchita",
    endpointUrl: "https://altosdecalamuchita.com/mcp/assistant",
    endpointHost: "altosdecalamuchita.com",
    authScheme: "bearer",
    status: "connected",
    sessionMode: "stateless",
    timezone: "America/Argentina/Cordoba",
    timeoutMs: 10000,
    maxResponseBytes: 524288,
    agentToolsEnabled: true,
    instructions: "Manual: primero start-booking, después set-guest-details, al final confirm-booking.",
    useServerInstructions: true,
    catalog: null,
    catalogFetchedAt: null,
    catalogTtlMinutes: 60,
    providerConfig: null,
    tools: effectiveTools([SEARCH, START, CONFIRM], policy, altos.allowedTools),
    hasCredential: true,
    resolveCredential: () => "secret",
    ...over,
  };
}

async function dyn(i: McpIntegration): Promise<DynamicToolsContext> {
  const d = await loadDynamicTools(i, "cv_1");
  if (!d) throw new Error("sin herramientas");
  return d;
}

const OPTS = {
  conversationId: "cv_1",
  sandbox: false,
  customerSinceLastReply: ["Sí, confirmo"],
  writesThisTurn: 0,
};

beforeEach(() => {
  callGuarded.mockReset();
  lastWriteAttempt.mockReset().mockResolvedValue(null);
  toolMemory.mockReset().mockResolvedValue([]);
});

describe("loadDynamicTools", () => {
  it("solo las genéricas ACTIVAS (ni las del perfil ni las pendientes)", async () => {
    const d = await dyn(integration({}, false));
    expect(d.tools.map((t) => t.name)).toEqual(["start-booking"]);
    expect(d.canWrite).toBe(false);
    const approved = await dyn(integration());
    expect(approved.tools.map((t) => t.name)).toEqual(["start-booking", "confirm-booking"]);
    expect(approved.canWrite).toBe(true);
  });

  it("sin genéricas activas → null (el turno es el de 031)", async () => {
    const i = integration({ tools: effectiveTools([SEARCH], null, altos.allowedTools) });
    expect(await loadDynamicTools(i, "cv_1")).toBeNull();
  });
});

describe("executeDynamicTool · consulta", () => {
  it("valida, completa conversation_id y devuelve el resultado con sus importes", async () => {
    callGuarded.mockResolvedValue({
      ok: true,
      sandbox: false,
      cached: false,
      data: { draft_id: "drf_1", summary: { total: 645000, deposit: 64500 } },
    });
    const i = integration();
    const out = await executeDynamicTool(i, await dyn(i), {
      tool: "start-booking",
      args: { property: "AC-004", check_in: "2026-11-10", check_out: "2026-11-12", guests: "4" },
    }, OPTS);
    expect(callGuarded).toHaveBeenCalledTimes(1);
    const call = callGuarded.mock.calls[0]![0] as { args: Record<string, unknown> };
    expect(call.args).toEqual({
      property: "AC-004",
      check_in: "2026-11-10",
      check_out: "2026-11-12",
      guests: 4,
      conversation_id: "cv_1",
    });
    expect(out.toolText).toContain("Resultado de «start-booking»");
    expect(out.toolText).toContain("drf_1");
    expect(out.amounts).toEqual(expect.arrayContaining([645000, 64500]));
    expect(out.wrote).toBeNull();
  });

  it("argumentos inválidos NO gastan una llamada", async () => {
    const i = integration();
    const out = await executeDynamicTool(i, await dyn(i), { tool: "start-booking", args: { property: "AC-004" } }, OPTS);
    expect(callGuarded).not.toHaveBeenCalled();
    expect(out.toolText).toContain("No llamé a «start-booking»");
    expect(out.toolText).toContain("check_in");
  });

  it("una herramienta del perfil por use_tool → usá search_stays", async () => {
    const i = integration();
    const out = await executeDynamicTool(i, await dyn(i), { tool: "check-availability" }, OPTS);
    expect(callGuarded).not.toHaveBeenCalled();
    expect(out.toolText).toContain("search_stays");
  });

  it("una escritura PENDIENTE no se usa", async () => {
    const i = integration({}, false);
    const out = await executeDynamicTool(i, await dyn(i), {
      tool: "confirm-booking",
      args: { draft_id: "drf_1", confirmed: true },
    }, OPTS);
    expect(callGuarded).not.toHaveBeenCalled();
    expect(out.toolText).toContain("no está habilitada");
  });
});

describe("executeDynamicTool · barrera de escritura", () => {
  const confirm = { tool: "confirm-booking", args: { draft_id: "drf_1", confirmed: true } };

  it("con «sí, confirmo» sale y queda registrada como escritura", async () => {
    callGuarded.mockResolvedValue({
      ok: true,
      sandbox: false,
      cached: false,
      data: { payment_url: "https://altosdecalamuchita.com/reserva/pago/res-1" },
    });
    const i = integration();
    const out = await executeDynamicTool(i, await dyn(i), confirm, OPTS);
    expect(callGuarded).toHaveBeenCalledTimes(1);
    expect(out.wrote).toEqual({ tool: "confirm-booking", title: "Registrar la reserva" });
    expect(out.toolText).toContain("ESCRITURA REALIZADA");
    expect(out.toolText).toContain("https://altosdecalamuchita.com/reserva/pago/res-1");
  });

  it("sin conformidad explícita NO sale", async () => {
    const i = integration();
    const out = await executeDynamicTool(i, await dyn(i), confirm, {
      ...OPTS,
      customerSinceLastReply: ["no, esperá"],
    });
    expect(callGuarded).not.toHaveBeenCalled();
    expect(out.toolText).toContain("conformidad explícita");
    expect(out.wrote).toBeNull();
  });

  it("la misma escritura que ya salió bien NO se repite", async () => {
    lastWriteAttempt.mockResolvedValue({ status: "ok", errorCode: null, resultExcerpt: '{"booking_id":"RES-1"}' });
    const i = integration();
    const out = await executeDynamicTool(i, await dyn(i), confirm, OPTS);
    expect(callGuarded).not.toHaveBeenCalled();
    expect(out.toolText).toContain("YA se ejecutó");
    expect(out.toolText).toContain("RES-1");
  });

  it("tras un timeout NO se reintenta (no se sabe si quedó registrada)", async () => {
    lastWriteAttempt.mockResolvedValue({ status: "error", errorCode: "timeout", resultExcerpt: null });
    const i = integration();
    const out = await executeDynamicTool(i, await dyn(i), confirm, OPTS);
    expect(callGuarded).not.toHaveBeenCalled();
    expect(out.toolText).toContain("handoff");
  });

  it("tras un rechazo del proveedor SÍ se puede reintentar (no se registró)", async () => {
    lastWriteAttempt.mockResolvedValue({ status: "error", errorCode: "missing_guest_data", resultExcerpt: null });
    callGuarded.mockResolvedValue({ ok: true, sandbox: false, cached: false, data: { ok: 1 } });
    const i = integration();
    await executeDynamicTool(i, await dyn(i), confirm, OPTS);
    expect(callGuarded).toHaveBeenCalledTimes(1);
  });

  it("una sola escritura por turno", async () => {
    const i = integration();
    const out = await executeDynamicTool(i, await dyn(i), confirm, { ...OPTS, writesThisTurn: 1 });
    expect(callGuarded).not.toHaveBeenCalled();
    expect(out.toolText).toContain("en este mismo turno");
  });

  it("un rechazo del sistema vuelve con su código, sin escritura", async () => {
    callGuarded.mockResolvedValue({
      ok: false,
      code: "tool_error",
      providerCode: "no_longer_available",
      details: null,
      message: "x",
    });
    const i = integration();
    const out = await executeDynamicTool(i, await dyn(i), confirm, OPTS);
    expect(out.toolText).toContain("no_longer_available");
    expect(out.toolText).toContain("NO registró nada");
    expect(out.wrote).toBeNull();
  });

  it("un timeout AL escribir avisa que no se sabe si quedó", async () => {
    callGuarded.mockResolvedValue({ ok: false, code: "timeout", message: "x" });
    const i = integration();
    const out = await executeDynamicTool(i, await dyn(i), confirm, OPTS);
    expect(out.failure).toBe("timeout");
    expect(out.toolText).toContain("NO sé si quedó registrado");
  });

  it("en el Laboratorio la respuesta simulada no cuenta como escritura", async () => {
    callGuarded.mockResolvedValue({ ok: true, sandbox: true, cached: false, data: { simulated: true } });
    const i = integration();
    const out = await executeDynamicTool(i, await dyn(i), confirm, { ...OPTS, sandbox: true });
    expect(lastWriteAttempt).not.toHaveBeenCalled();
    expect(out.wrote).toBeNull();
  });
});

describe("renderDynamicSection", () => {
  it("reglas afuera, texto del proveedor adentro de la valla, memoria y celular", async () => {
    toolMemory.mockResolvedValue([
      {
        id: "c1",
        tool: "start-booking",
        args: { property: "AC-004" },
        status: "ok",
        errorCode: null,
        write: false,
        resultExcerpt: '{"draft_id":"drf_7"}',
        createdAt: new Date("2026-10-07T15:00:00Z"),
      },
    ]);
    const i = integration();
    const d = await dyn(i);
    const fence = makeForeignFence();
    const text = renderDynamicSection({ integration: i, dynamic: d, fence, contactPhone: "5493511234567" });
    expect(text.startsWith(`${DYNAMIC_TOOLS_HEADING} ALTOS DE CALAMUCHITA`)).toBe(true);
    expect(text).toContain("### confirm-booking — Registrar la reserva · ESCRIBE");
    expect(text).toContain("Manual: primero start-booking");
    expect(text).toContain('"draft_id":"drf_7"');
    expect(text).toContain("5493511234567");
    // Las descripciones van DESPUÉS de la apertura de la valla.
    expect(text.indexOf(fence.open)).toBeLessThan(text.indexOf("### start-booking"));
  });

  it("sin consentimiento de la empresa, el manual NO entra", async () => {
    const i = integration({ useServerInstructions: false });
    const text = renderDynamicSection({
      integration: i,
      dynamic: await dyn(i),
      fence: makeForeignFence(),
      contactPhone: null,
    });
    expect(text).not.toContain("Manual: primero");
  });
});

describe("altos.renderSection con reservas (032)", () => {
  const base = {
    catalog: null,
    now: new Date("2026-10-07T15:00:00Z"),
    status: "connected" as const,
    agentToolsEnabled: true,
  };

  it("sin herramientas de reserva: «no toma reservas» como siempre", () => {
    const text = altos.renderSection(base) as string;
    expect(text).toContain("ESTE NEGOCIO NO TOMA RESERVAS POR WHATSAPP");
  });

  it("con herramientas de reserva: puede dejarla iniciada y el resumen lleva importes", () => {
    const text = altos.renderSection({ ...base, bookingTools: true }) as string;
    expect(text).not.toContain("NO TOMA RESERVAS");
    expect(text).toContain("PUEDE dejar la reserva iniciada");
    expect(text).toContain("ÚNICA EXCEPCIÓN");
  });
});

describe("renderConnectorForTrainer (032, US5)", () => {
  it("lista las herramientas con su estado y dice dónde se aprueba", () => {
    const text = renderConnectorForTrainer(integration({}, false)) as string;
    expect(text).toContain("TU CONECTOR CON EL SISTEMA DEL NEGOCIO: Altos de Calamuchita (conectado)");
    expect(text).toContain("NO hace falta que nadie te las pegue");
    expect(text).toMatch(/- confirm-booking — Registrar la reserva \(ESCRIBE\) · PENDIENTE DE APROBAR/);
    expect(text).toMatch(/- start-booking — Iniciar una reserva \(consulta\) · ACTIVA/);
    expect(text).toContain("Manual: primero start-booking");
  });

  it("un conector sin perfil también entra", () => {
    const i = integration({ profile: generic, profileKey: "generic" });
    expect(renderConnectorForTrainer(i)).toContain("check-availability");
  });
});
