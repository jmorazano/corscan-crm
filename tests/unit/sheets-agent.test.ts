import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentAction, isSheetsAction } from "@/server/ai/actions";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { executeSearchSheet, type SheetsContext } from "@/server/sheets/sources";

/**
 * 034: lo que ve el agente de Google Sheets — sección de planillas,
 * `search_sheet` solo cuando hace falta, línea de comprobantes — y la
 * frontera del cliente de Sheets (anti-fórmula y errores tipados).
 */

const profile = {
  id: "agp_1",
  organizationId: "org_1",
  enabled: true,
  name: "Ari",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
  replyDelayMs: null,
  teamSilenceMs: null,
  sharedPersonalNumber: false,
  readVideos: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("prompt del agente", () => {
  it("sin planillas no hay sección ni acción", () => {
    const p = buildAgentSystemPrompt({ profile, kb: [], stages: [] });
    expect(p).not.toContain("search_sheet");
    expect(p).not.toContain("planilla de conciliación");
  });

  it("planillas completas: sección como DATO, sin search_sheet", () => {
    const p = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      sheetsSection: "PLANILLAS DEL NEGOCIO (…)\n### «Precios › 2026»\n- Cabaña: Arroyo",
      sheetsSearchable: false,
    });
    expect(p).toContain("PLANILLAS DEL NEGOCIO");
    expect(p).not.toContain('"action":"search_sheet"');
  });

  it("planilla recortada: ofrece search_sheet y explica [PLANILLA]", () => {
    const p = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      sheetsSection: "PLANILLAS DEL NEGOCIO (…)",
      sheetsSearchable: true,
    });
    expect(p).toContain('"action":"search_sheet"');
    expect(p).toContain('"[PLANILLA]"');
    expect(p).toContain("NUNCA anuncies que vas a buscar");
  });

  it("comprobantes a la planilla: el agente confirma sin datos bancarios", () => {
    const p = buildAgentSystemPrompt({ profile, kb: [], stages: [], receiptsToSheet: true });
    expect(p).toContain("planilla de conciliación");
    expect(p).toContain("no repitas importes ni datos bancarios");
  });

  it("search_sheet es una acción válida y se reconoce", () => {
    const parsed = AgentAction.parse({ action: "search_sheet", sheet: "Precios › 2026", query: "arroyo" });
    expect(isSheetsAction(parsed)).toBe(true);
    const sinQuery = AgentAction.parse({ action: "search_sheet" });
    expect(sinQuery).toMatchObject({ action: "search_sheet", query: "" });
  });
});

describe("executeSearchSheet", () => {
  const ctx: SheetsContext = {
    section: "x",
    searchable: true,
    receiptsEnabled: false,
    amounts: [],
    sources: [
      {
        label: "Precios 2026 › Temporadas",
        rows: [
          ["Cabaña", "Temporada", "Precio"],
          ["Arroyo", "Alta", "$ 120.000"],
          ["Bosque", "Baja", "$ 80.000"],
        ],
      },
      { label: "Stock › Hoy", rows: [["Producto", "Cantidad"], ["Leña", "12"]] },
    ],
  };

  it("busca en la planilla pedida y deja salir sus importes", () => {
    const out = executeSearchSheet(ctx, { sheet: "precios 2026 › temporadas", query: "arroyo" });
    expect(out.toolText).toContain("[PLANILLA]");
    expect(out.toolText).toContain("Precio: $ 120.000");
    expect(out.amounts).toContain(120000);
  });

  it("acepta un nombre parcial", () => {
    expect(executeSearchSheet(ctx, { sheet: "Stock", query: "leña" }).toolText).toContain("Cantidad: 12");
  });

  it("planilla inexistente: lista las disponibles y no deja inventar", () => {
    const out = executeSearchSheet(ctx, { sheet: "Clientes", query: "x" });
    expect(out.toolText).toContain("No encontré la planilla");
    expect(out.toolText).toContain("«Stock › Hoy»");
  });
});

describe("cliente de Sheets", () => {
  beforeAll(() => {
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
    process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
    process.env.GOOGLE_SHEETS_API_BASE_URL = "https://sheets.test";
    // getEnv() se cachea en el primer uso: todo lo de Google va acá.
    process.env.GOOGLE_CLIENT_ID = "123-test.apps.googleusercontent.com";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("appendRow neutraliza fórmulas en la frontera y usa la pestaña entre comillas", async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return Response.json({ updates: { updatedRange: "Pagos!A2:B2" } });
      })
    );
    const { appendRow } = await import("@/lib/google/sheets-client");
    const res = await appendRow("tok", "sheet_1", "Pagos", ["=HYPERLINK(1)", "80000"]);
    expect(res.updatedRange).toBe("Pagos!A2:B2");
    expect(calls[0]!.url).toContain(encodeURIComponent("'Pagos'!A1") + ":append");
    expect(calls[0]!.url).toContain("valueInputOption=USER_ENTERED");
    expect(calls[0]!.body).toEqual({ majorDimension: "ROWS", values: [["'=HYPERLINK(1)", "80000"]] });
  });

  it("403 de Google = sin acceso (planilla no elegida con el selector)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    const { getSpreadsheet, SheetsApiError } = await import("@/lib/google/sheets-client");
    await expect(getSpreadsheet("tok", "x")).rejects.toMatchObject({ code: "no_access" });
    await expect(getSpreadsheet("tok", "x")).rejects.toBeInstanceOf(SheetsApiError);
  });
});

describe("permisos pedidos a Google (verificación)", () => {
  it("Sheets pide solo drive.file, sin sumar permisos ya otorgados", async () => {
    const { buildAuthUrl } = await import("@/lib/google/oauth");
    const url = new URL(buildAuthUrl("st", "sheets", { loginHint: "a@b.c" }));
    expect(url.searchParams.get("scope")).toBe(
      "openid email https://www.googleapis.com/auth/drive.file"
    );
    expect(url.searchParams.has("include_granted_scopes")).toBe(false);
    expect(url.searchParams.get("login_hint")).toBe("a@b.c");
    expect(url.searchParams.get("redirect_uri")).toContain("/api/integrations/google-sheets/callback");
  });

  it("Calendar pide los mínimos: nunca calendar.readonly", async () => {
    const { buildAuthUrl } = await import("@/lib/google/oauth");
    const scope = new URL(buildAuthUrl("st")).searchParams.get("scope") ?? "";
    expect(scope).not.toContain("calendar.readonly");
    expect(scope).toContain("calendar.calendarlist.readonly");
    expect(scope).toContain("calendar.freebusy");
    expect(scope).toContain("calendar.events");
  });
});
