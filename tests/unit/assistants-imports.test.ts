import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 040 (FR-009): el servidor MCP de los asistentes no envía nada. Ningún
 * módulo suyo puede importar lo que envía mensajes, el pipeline del agente,
 * el cliente de Meta ni el conector MCP de 016 (salvo su saneo puro).
 *
 * 041 (constitución 1.14.0): la ÚNICA escritura es enseñarle al agente (su
 * perfil y su conocimiento), y vive en un solo archivo: `teach.ts`. Ningún
 * otro módulo del servidor de asistentes importa el motor del Entrenador,
 * el servicio del conocimiento ni el del perfil.
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

const WRITERS = [/^@\/server\/trainer\/changes$/, /^@\/server\/kb\/service$/, /^@\/server\/ai\/profile$/];
const TEACH_MODULE = path.join("src", "server", "assistants", "teach.ts");

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

  it.each(all.map((f) => [path.relative(process.cwd(), f), f]))("%s escribe en el agente solo si es teach.ts", (rel, file) => {
    if (rel === TEACH_MODULE) return;
    const src = readFileSync(file, "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    expect(imports.filter((i) => WRITERS.some((re) => re.test(i)))).toEqual([]);
  });
});
