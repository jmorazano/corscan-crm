import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CALENDAR_MARKER_LITERAL,
  JUDGE_MARKER_LITERAL,
  MCP_MARKER,
  PROMPT_HARD_RULES_HEADING,
  PROMPT_JSON_HEADING,
  PROMPT_KB_HEADING,
  PROMPT_STAGES_HEADING,
  SYSTEM_MARKERS,
  TOOL_MARKER_LITERAL,
  TRAINER_MARKER_LITERAL,
  TRANSACTIONAL_MARKER_LITERAL,
} from "@/server/mcp/markers";

/**
 * `markers.ts` es un módulo HOJA (corrección #33): copia las literales en
 * vez de importarlas, para no arrastrar la base de datos dentro de una
 * función de strings. El precio de esa decisión es la deriva, y este test
 * es quien la paga: lee los archivos originales y verifica que cada cadena
 * siga existiendo ahí.
 */
const ROOT = path.resolve(__dirname, "..", "..");

function source(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

describe("markers: guardia contra la deriva", () => {
  it("las cuatro cadenas estructurales siguen en prompts.ts", () => {
    const prompts = source("src/server/ai/prompts.ts");
    for (const literal of [
      PROMPT_KB_HEADING,
      PROMPT_STAGES_HEADING,
      PROMPT_JSON_HEADING,
      PROMPT_HARD_RULES_HEADING,
      JUDGE_MARKER_LITERAL,
      TRANSACTIONAL_MARKER_LITERAL,
    ]) {
      expect(prompts, `falta "${literal}" en prompts.ts`).toContain(literal);
    }
  });

  it("TOOL_MARKER y AGENDA DE TURNOS siguen en calendar/agent-tools.ts", () => {
    const calendar = source("src/server/calendar/agent-tools.ts");
    expect(calendar).toContain(TOOL_MARKER_LITERAL);
    expect(calendar).toContain(CALENDAR_MARKER_LITERAL);
  });

  it("TRAINER_MARKER sigue en trainer-prompts.ts", () => {
    expect(source("src/server/ai/trainer-prompts.ts")).toContain(TRAINER_MARKER_LITERAL);
  });

  it("SYSTEM_MARKERS incluye todos los marcadores conocidos y va de más largo a más corto", () => {
    for (const literal of [
      MCP_MARKER,
      TOOL_MARKER_LITERAL,
      CALENDAR_MARKER_LITERAL,
      JUDGE_MARKER_LITERAL,
      TRANSACTIONAL_MARKER_LITERAL,
      TRAINER_MARKER_LITERAL,
      PROMPT_KB_HEADING,
      PROMPT_STAGES_HEADING,
      PROMPT_JSON_HEADING,
      PROMPT_HARD_RULES_HEADING,
    ]) {
      expect(SYSTEM_MARKERS).toContain(literal);
    }
    // Ningún marcador puede ser prefijo de otro que venga DESPUÉS: si lo
    // fuera, la alternancia del regex se comería el más específico.
    SYSTEM_MARKERS.forEach((marker, i) => {
      for (const later of SYSTEM_MARKERS.slice(i + 1)) {
        expect(later.startsWith(marker)).toBe(false);
      }
    });
  });

  it("no tiene dependencias: markers.ts no importa nada", () => {
    expect(source("src/server/mcp/markers.ts")).not.toMatch(/^\s*import\s/m);
  });
});
