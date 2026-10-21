import { afterEach, describe, expect, it, vi } from "vitest";
import { isRetryableSendCode, withSendRetry } from "@/lib/send-retry";
import {
  BROADCAST_MIN_CONVERSATIONS,
  broadcastKey,
  isBroadcast,
  pendingAfterTeam,
} from "@/lib/agent-presence";
import { pendingCustomerMessages } from "@/server/ai/pipeline";
import { buildAgentSystemPrompt, TEAM_RESUME_MARKER, teamResumeSection } from "@/server/ai/prompts";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import { eventText } from "@/lib/conversation-events";

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  getEnv: () => ({
    META_GRAPH_BASE_URL: "https://graph.test",
    META_GRAPH_API_VERSION: "v21.0",
    AGENT_COALESCE_MS: 20_000,
  }),
}));

/**
 * 036 (decisión del dueño, 13-oct-2026): el envío del agente reintenta ante
 * errores transitorios de Meta; al vencer la ventana del equipo el agente
 * retoma solo si el cliente quedó esperando; una difusión del equipo no lo
 * calla.
 */

class CodedError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
const codeOf = (err: unknown) => (err instanceof CodedError ? err.code : null);
const noSleep = () => Promise.resolve();

describe("withSendRetry", () => {
  it("solo meta_unavailable es reintentable", () => {
    expect(isRetryableSendCode("meta_unavailable")).toBe(true);
    for (const c of ["meta_error", "window_closed", "reconnect_required", "not_connected", null, undefined]) {
      expect(isRetryableSendCode(c)).toBe(false);
    }
  });

  it("Meta cae una vez → el segundo intento sale (una sola entrega)", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new CodedError("meta_unavailable"))
      .mockResolvedValueOnce("ok");
    const onRetry = vi.fn();
    await expect(withSendRetry(fn, { codeOf, sleep: noSleep, onRetry })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, "meta_unavailable");
  });

  it("tres fallos seguidos → se rinde con el último error (2 reintentos)", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new CodedError("meta_unavailable"));
    const sleeps: number[] = [];
    await expect(
      withSendRetry(fn, { codeOf, sleep: async (ms) => void sleeps.push(ms) })
    ).rejects.toMatchObject({ code: "meta_unavailable" });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([2_000, 5_000]);
  });

  it("errores definitivos no se reintentan", async () => {
    for (const code of ["window_closed", "reconnect_required", "meta_error"]) {
      const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new CodedError(code));
      await expect(withSendRetry(fn, { codeOf, sleep: noSleep })).rejects.toMatchObject({ code });
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("una excepción desconocida no se reintenta", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("boom"));
    await expect(withSendRetry(fn, { codeOf, sleep: noSleep })).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("graphRequest — tope de tiempo (036)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("una conexión colgada corta y es «Meta no disponible» (status 0)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })
      )
    );
    const err = await graphRequest("123/messages", { method: "POST", token: "t", body: {}, timeoutMs: 20 }).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(MetaApiError);
    expect((err as MetaApiError).status).toBe(0);
  });

  it("un cuerpo que no termina también corta con status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: () => Promise.reject(new DOMException("aborted", "AbortError")),
      }))
    );
    const err = await graphRequest("123/messages", { token: "t" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect((err as MetaApiError).status).toBe(0);
  });

  it("todo pedido viaja con señal de corte", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => '{"ok":true}',
    }));
    vi.stubGlobal("fetch", fetchMock);
    await graphRequest("x", { token: "t" });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("pendingAfterTeam", () => {
  const MIN = 60_000;
  const team = new Date("2026-10-08T23:22:00Z");
  const at = (min: number) => new Date(team.getTime() + min * MIN);

  it("el cliente escribió durante la ventana → retoma", () => {
    expect(pendingAfterTeam({ lastTeamAt: team, windowMs: 10 * MIN, lastInboundAt: at(3) })).toBe(true);
  });

  it("escribió después de la ventana → turno normal, no retoma", () => {
    expect(pendingAfterTeam({ lastTeamAt: team, windowMs: 10 * MIN, lastInboundAt: at(12) })).toBe(false);
  });

  it("sin equipo o el entrante es anterior → no", () => {
    expect(pendingAfterTeam({ lastTeamAt: null, windowMs: 10 * MIN, lastInboundAt: at(3) })).toBe(false);
    expect(pendingAfterTeam({ lastTeamAt: team, windowMs: 10 * MIN, lastInboundAt: at(-1) })).toBe(false);
  });
});

describe("isBroadcast", () => {
  const base = { text: "Se me libero este 👇", customerWroteBefore: false, sameTextConversations: 8 };

  it("mismo texto a 8 chats que no venían escribiendo → difusión", () => {
    expect(isBroadcast(base)).toBe(true);
  });

  it(`hace falta ≥ ${BROADCAST_MIN_CONVERSATIONS} chats`, () => {
    expect(isBroadcast({ ...base, sameTextConversations: BROADCAST_MIN_CONVERSATIONS })).toBe(true);
    expect(isBroadcast({ ...base, sameTextConversations: BROADCAST_MIN_CONVERSATIONS - 1 })).toBe(false);
  });

  it("si le responde a alguien que estaba escribiendo, es atender (aunque se repita)", () => {
    expect(isBroadcast({ ...base, text: "Ya se reservo disculpas", customerWroteBefore: true })).toBe(false);
  });

  it("sin texto no se evalúa", () => {
    expect(broadcastKey("   ")).toBeNull();
    expect(isBroadcast({ ...base, text: null })).toBe(false);
  });
});

describe("pendingCustomerMessages", () => {
  it("lo del cliente después del último saliente", () => {
    const history = [
      { id: "1", direction: "in", type: "text" },
      { id: "2", direction: "out", type: "text" },
      { id: "3", direction: "in", type: "text" },
      { id: "4", direction: "in", type: "text" },
    ];
    expect(pendingCustomerMessages(history).map((m) => m.id)).toEqual(["3", "4"]);
  });

  it("si lo último es del negocio, nada pendiente", () => {
    expect(
      pendingCustomerMessages([
        { direction: "in", type: "text" },
        { direction: "out", type: "text" },
      ])
    ).toEqual([]);
  });

  it("038: una reacción del cliente no lo deja esperando", () => {
    expect(
      pendingCustomerMessages([
        { direction: "out", type: "text" },
        { direction: "in", type: "reaction" },
      ])
    ).toEqual([]);
  });
});

describe("prompt de retoma", () => {
  const prompt = (teamResume: { minutesWaiting: number } | null) =>
    buildAgentSystemPrompt({
      profile: {
        name: "Giuliana",
        tone: null,
        instructions: null,
        escalationRules: null,
        greeting: null,
      } as never,
      kb: [],
      stages: [],
      teamIntervened: true,
      teamResume,
    });

  it("la sección aparece solo al retomar, con los minutos de espera", () => {
    expect(prompt(null)).not.toContain(TEAM_RESUME_MARKER);
    const p = prompt({ minutesWaiting: 10 });
    expect(p).toContain(TEAM_RESUME_MARKER);
    expect(p).toContain("hace 10 min");
    expect(teamResumeSection(3)).toContain('"action":"none"');
  });
});

describe("línea del hilo", () => {
  it("el silencio por el equipo avisa que retoma si el cliente queda esperando", () => {
    const { text } = eventText(
      { kind: "ai_silent", reason: "team_active", actorName: null, details: { until: "2026-10-08T23:32:00Z" } },
      () => "20:32"
    );
    expect(text).toContain("A las 20:32 retoma sola si el cliente quedó esperando respuesta.");
  });
});
