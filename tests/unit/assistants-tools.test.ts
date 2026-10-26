import { describe, expect, it } from "vitest";
import { listToolsForMcp } from "@/server/assistants/tools";
import { ToolInputError, resolvePeriod } from "@/server/assistants/tools/common";
import { changeRatio, isoInZone } from "@/lib/assistants/format";

/** 040 (contracts/mcp-tools.md): catálogo de herramientas y piezas comunes. */
describe("listToolsForMcp", () => {
  const tools = listToolsForMcp();

  const WRITE = {
    teach_agent: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    edit_agent: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    undo_agent_change: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  } as const;

  it("publica 17 herramientas: las 12 de la 040 de solo lectura y las 5 del agente (041)", () => {
    expect(tools).toHaveLength(17);
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "list_workspaces",
        "get_message_metrics",
        "get_conversation_origins",
        "list_campaigns",
        "get_campaign",
        "get_agent_knowledge",
        "teach_agent",
        "edit_agent",
        "list_agent_changes",
        "undo_agent_change",
      ])
    );
    for (const t of tools) {
      const write = WRITE[t.name as keyof typeof WRITE];
      expect(t.annotations).toMatchObject(
        write
          ? { ...write, openWorldHint: false }
          : { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
      );
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema).not.toHaveProperty("$schema");
    }
  });

  it("teach_agent solo agrega y edit_agent solo corrige o borra", () => {
    const ops = (name: string) =>
      JSON.stringify(tools.find((t) => t.name === name)!.inputSchema).match(/"const":"(\w+)"/g)?.map((m) => m.slice(9, -1));
    expect(ops("teach_agent")?.sort()).toEqual(["kb_add", "profile_append"]);
    expect(ops("edit_agent")?.sort()).toEqual(["kb_delete", "kb_update", "profile_set"]);
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
