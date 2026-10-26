import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 040 (FR-009): el servidor MCP de los asistentes es de SOLO LECTURA. Ningún
 * módulo suyo puede importar lo que envía mensajes, el pipeline del agente,
 * el cliente de Meta ni el conector MCP de 016 (salvo su saneo puro).
 */

const ROOTS = ["src/server/assistants", "src/lib/mcp-server", "src/lib/assistants"];

const FORBIDDEN = [
  /^@\/server\/inbox\/send/,
  /^@\/server\/whatsapp\//,
  /^@\/server\/instagram\/send/,
  /^@\/server\/ai\/pipeline/,
  /^@\/server\/campaigns\/runner/,
  /^@\/lib\/meta\//,
  /^@\/lib\/instagram\/client/,
  /^@\/server\/mcp\/(?!sanitize$|markers$)/,
];

function files(dir: string): string[] {
  const abs = path.resolve(dir);
  return readdirSync(abs).flatMap((name) => {
    const full = path.join(abs, name);
    if (statSync(full).isDirectory()) return files(path.join(dir, name));
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("imports del servidor MCP de asistentes", () => {
  const all = ROOTS.flatMap(files);

  it("hay archivos que revisar", () => {
    expect(all.length).toBeGreaterThan(3);
  });

  it.each(all.map((f) => [path.relative(process.cwd(), f), f]))("%s no importa módulos que escriben", (_rel, file) => {
    const src = readFileSync(file, "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    const bad = imports.filter((i) => FORBIDDEN.some((re) => re.test(i)));
    expect(bad).toEqual([]);
  });
});
