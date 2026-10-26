import { describe, expect, it } from "vitest";
import { listToolsForMcp } from "@/server/assistants/tools";
import { ToolInputError, resolvePeriod } from "@/server/assistants/tools/common";
import { changeRatio, isoInZone } from "@/lib/assistants/format";

/** 040 (contracts/mcp-tools.md): catálogo de herramientas y piezas comunes. */
describe("listToolsForMcp", () => {
  const tools = listToolsForMcp();

  it("publica las herramientas del MVP, todas de solo lectura", () => {
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "list_workspaces",
        "get_message_metrics",
        "get_conversation_origins",
        "list_campaigns",
        "get_campaign",
      ])
    );
    for (const t of tools) {
      expect(t.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema).not.toHaveProperty("$schema");
    }
  });

  it("las herramientas con empresa piden `workspace` y los períodos sus enums", () => {
    const metrics = tools.find((t) => t.name === "get_message_metrics")!;
    const props = metrics.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props).toHaveProperty("workspace");
    expect(props.period?.enum).toContain("last_week");
    expect(Object.keys(tools.find((t) => t.name === "list_workspaces")!.inputSchema.properties ?? {})).toEqual([]);
  });
});

describe("resolvePeriod", () => {
  const now = new Date("2026-10-26T18:30:00Z");

  it("default últimos 30 días en Buenos Aires", () => {
    const { window, timeZone } = resolvePeriod({}, now);
    expect(timeZone).toBe("America/Argentina/Buenos_Aires");
    expect(window.keys).toHaveLength(30);
  });

  it("from sin to, zona inválida y rango al revés → ToolInputError", () => {
    expect(() => resolvePeriod({ from: "2026-10-01" }, now)).toThrow(ToolInputError);
    expect(() => resolvePeriod({ timezone: "Marte/Olympus" }, now)).toThrow(/Zona horaria/);
    expect(() => resolvePeriod({ from: "2026-10-10", to: "2026-10-01" }, now)).toThrow(ToolInputError);
  });
});

describe("format", () => {
  it("isoInZone lleva el offset de la zona", () => {
    expect(isoInZone(new Date("2026-10-20T17:03:09Z"), "America/Argentina/Buenos_Aires")).toBe(
      "2026-10-20T14:03:09-03:00"
    );
    expect(isoInZone(new Date("2026-07-01T10:00:00Z"), "Europe/Madrid")).toBe("2026-07-01T12:00:00+02:00");
    expect(isoInZone(null, "UTC")).toBeNull();
  });

  it("changeRatio", () => {
    expect(changeRatio(120, 100)).toBe(0.2);
    expect(changeRatio(5, 0)).toBeNull();
  });
});
