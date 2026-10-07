import { createHash } from "node:crypto";

/**
 * POLÍTICA DE HERRAMIENTAS POR EMPRESA (032).
 *
 * Hasta 031 la lista de herramientas que el agente podía usar estaba
 * cableada en el perfil (`ALLOWED_TOOLS`): que el servidor publicara una
 * herramienta nueva no servía de nada sin un deploy. Ahora la fuente de
 * verdad es lo que el servidor publica en `tools/list`, y una PERSONA decide
 * —sin deploy— qué se usa:
 *
 * - **Consulta** (`readOnlyHint: true`): activa por defecto; se puede apagar.
 * - **Escritura** (cualquier otra): pendiente hasta que el propietario o el
 *   super admin la apruebe. La aprobación vale para la FIRMA de la
 *   herramienta (descripción + parámetros + anotaciones): si el servidor la
 *   cambia, vuelve a pendiente. Que el tercero cambie qué hace una
 *   herramienta que escribe en su sistema no puede heredar un «sí» viejo.
 * - **Perfil**: las que el perfil del proveedor ya sabe leer y condensar
 *   (Altos: búsqueda y ficha). Las gobierna «Herramientas del agente», no
 *   esta política, y el agente las usa por sus acciones propias.
 *
 * Módulo puro (salvo el hash): entra la fila, sale el estado. Sin base.
 */

export type StoredTool = {
  name: string;
  description: string | null;
  readOnly: boolean;
  title?: string | null;
  inputSchema?: Record<string, unknown> | null;
  annotations?: Record<string, boolean> | null;
  signature?: string;
};

export type ToolPolicyEntry = {
  enabled: boolean;
  /** Firma de la herramienta cuando se decidió. `null` = filas viejas. */
  signature: string | null;
  /** Quién decidió (user id). */
  by: string | null;
  /** ISO. */
  at: string;
};

export type ToolPolicy = Record<string, ToolPolicyEntry>;

export type ToolKind = "read" | "write";

/**
 * - `profile`: la usa el perfil por sus acciones propias.
 * - `active`: el agente la puede usar por el camino genérico (`use_tool`).
 * - `pending`: escritura sin aprobar (o aprobada para otra firma).
 * - `off`: una persona la apagó.
 * - `stale`: fila guardada antes de 032 (sin parámetros ni descripción
 *   completa). No se ofrece al agente hasta el próximo «Verificar
 *   conexión»: usarla así sería operar a ciegas.
 */
export type ToolState = "profile" | "active" | "pending" | "off" | "stale";

export type EffectiveTool = StoredTool & {
  kind: ToolKind;
  state: ToolState;
  /** `idempotentHint: true` explícito: solo esas pueden salir de la caché. */
  idempotent: boolean;
};

/** Hash corto y estable de lo que define a una herramienta. */
export function toolSignature(tool: {
  name: string;
  description?: string | null;
  readOnly?: boolean;
  inputSchema?: unknown;
  annotations?: unknown;
}): string {
  // `readOnly` entra en la firma: una consulta que pasa a escribir es OTRA
  // herramienta y no hereda ninguna aprobación.
  const payload = stableJson({
    name: tool.name,
    description: tool.description ?? null,
    readOnly: tool.readOnly === true,
    inputSchema: tool.inputSchema ?? null,
    annotations: tool.annotations ?? null,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

/** Consulta solo si el servidor la declara EXPLÍCITAMENTE de solo lectura. */
export function classifyTool(tool: Pick<StoredTool, "readOnly">): ToolKind {
  return tool.readOnly === true ? "read" : "write";
}

/** Firma de una fila: la guardada o, en filas viejas, la calculada. */
export function signatureOf(tool: StoredTool): string {
  return (
    tool.signature ??
    toolSignature({
      name: tool.name,
      description: tool.description,
      readOnly: tool.readOnly,
      inputSchema: tool.inputSchema ?? null,
      annotations: tool.annotations ?? null,
    })
  );
}

/** Estado efectivo de UNA herramienta. */
export function toolState(
  tool: StoredTool,
  entry: ToolPolicyEntry | undefined,
  profileTools: readonly string[]
): ToolState {
  if (profileTools.includes(tool.name)) return "profile";
  if (!tool.signature) return "stale";
  if (classifyTool(tool) === "read") {
    // Una consulta que una persona apagó queda apagada aunque cambie.
    return entry && entry.enabled === false ? "off" : "active";
  }
  const signature = signatureOf(tool);
  if (!entry || entry.signature !== signature) return "pending";
  return entry.enabled ? "active" : "off";
}

/** Todas las herramientas de la fila con su estado efectivo. */
export function effectiveTools(
  tools: readonly StoredTool[] | null | undefined,
  policy: ToolPolicy | null | undefined,
  profileTools: readonly string[]
): EffectiveTool[] {
  if (!Array.isArray(tools)) return [];
  const out: EffectiveTool[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (!tool || typeof tool.name !== "string" || !tool.name || seen.has(tool.name)) continue;
    seen.add(tool.name);
    out.push({
      ...tool,
      kind: classifyTool(tool),
      state: toolState(tool, policy?.[tool.name], profileTools),
      idempotent: tool.annotations?.idempotentHint === true,
    });
  }
  return out;
}

/** Las que el agente puede usar por `use_tool`. */
export function activeGenericTools(tools: readonly EffectiveTool[]): EffectiveTool[] {
  return tools.filter((t) => t.state === "active");
}

/**
 * Registra la decisión de una persona sobre una herramienta. La firma que se
 * guarda es la ACTUAL: aprobar «esta» definición, no cualquiera futura.
 */
export function applyToolDecision(
  policy: ToolPolicy | null | undefined,
  tool: StoredTool,
  enabled: boolean,
  by: string | null,
  now: Date
): ToolPolicy {
  return {
    ...(policy ?? {}),
    [tool.name]: { enabled, signature: signatureOf(tool), by, at: now.toISOString() },
  };
}
