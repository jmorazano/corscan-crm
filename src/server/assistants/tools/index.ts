import { z } from "zod/v4";
import { toolError, toolResult, type ToolCallResult } from "@/lib/mcp-server/jsonrpc";
import type { GrantWorkspace } from "@/lib/assistants/authorize";
import { authorizeWorkspace, type AssistantCall } from "../access";
import { logAssistantCall, type AccessReason } from "../log";
import { ToolInputError, ToolNotFoundError, type AssistantTool } from "./common";
import { listWorkspacesTool } from "./workspaces";
import { metricsTools } from "./metrics";
import { campaignTools } from "./campaigns";
import { conversationTools } from "./conversations";
import { contactTools } from "./contacts";
import { pipelineTools } from "./pipeline";

/**
 * Catálogo de herramientas de SOLO LECTURA del servidor MCP de los
 * asistentes (040, specs/040-crm-mcp-server/contracts/mcp-tools.md).
 *
 * Toda herramienta con `workspace` pasa por `authorizeWorkspace` ANTES de
 * correr (FR-007) y queda en el registro de la empresa (FR-025).
 */

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const ASSISTANT_TOOLS: readonly AssistantTool[] = [
  listWorkspacesTool,
  ...metricsTools,
  ...campaignTools,
  ...conversationTools,
  ...contactTools,
  ...pipelineTools,
];

const BY_NAME = new Map(ASSISTANT_TOOLS.map((t) => [t.name, t]));

export function listToolsForMcp() {
  return ASSISTANT_TOOLS.map((t) => {
    const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(t.input, { io: "input" }) as Record<
      string,
      unknown
    >;
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema,
      annotations: { title: t.title, ...READ_ONLY_ANNOTATIONS },
    };
  });
}

export function isKnownTool(name: string): boolean {
  return BY_NAME.has(name);
}

function issuesText(error: z.ZodError): string {
  const parts = error.issues.slice(0, 5).map((i) => {
    const path = i.path.length > 0 ? i.path.join(".") : "argumentos";
    return `${path}: ${i.message}`;
  });
  return `Argumentos inválidos — ${parts.join("; ")}`;
}

const INTERNAL_TEXT = "No pude consultar el CRM en este momento. Probá de nuevo en unos segundos.";

export async function callTool(
  call: AssistantCall,
  name: string,
  rawArgs: unknown,
  now: Date = new Date()
): Promise<ToolCallResult> {
  const tool = BY_NAME.get(name);
  if (!tool) return toolError(`No existe la herramienta «${name}».`);

  const log = (orgIds: readonly string[], summary: string, outcome: "ok" | "denied" | "error", reason?: AccessReason) =>
    logAssistantCall({
      organizationIds: orgIds,
      grantId: call.grantId,
      userId: call.userId,
      clientLabel: call.clientLabel,
      tool: tool.name,
      summary,
      outcome,
      reason: reason ?? null,
    });

  const parsed = tool.input.safeParse(rawArgs ?? {});
  let workspace: GrantWorkspace | null = null;
  if (tool.needsWorkspace) {
    const ref =
      rawArgs && typeof rawArgs === "object" && typeof (rawArgs as { workspace?: unknown }).workspace === "string"
        ? ((rawArgs as { workspace: string }).workspace)
        : undefined;
    const auth = await authorizeWorkspace(call, ref);
    if (!auth.ok) {
      log(auth.workspace ? [auth.workspace.id] : [], tool.title, "denied", auth.reason);
      return toolError(auth.text);
    }
    workspace = auth.workspace;
  }
  const orgIds = workspace ? [workspace.id] : call.workspaces.map((w) => w.id);

  if (!parsed.success) {
    log(orgIds, tool.title, "denied", "invalid_args");
    return toolError(issuesText(parsed.error));
  }
  const args = parsed.data as Record<string, unknown>;
  const summary = safeDescribe(tool, args);
  try {
    const out = await tool.run({ call, workspace, now }, args);
    log(orgIds, out.summary ?? summary, "ok");
    return toolResult(out.data);
  } catch (err) {
    if (err instanceof ToolNotFoundError) {
      log(orgIds, summary, "denied", "not_found");
      return toolError(err.message);
    }
    if (err instanceof ToolInputError) {
      log(orgIds, summary, "denied", "invalid_args");
      return toolError(err.message);
    }
    console.error(`[assistants] ${tool.name} falló:`, (err as Error)?.message ?? err);
    log(orgIds, summary, "error", "internal");
    return toolError(INTERNAL_TEXT);
  }
}

function safeDescribe(tool: AssistantTool, args: Record<string, unknown>): string {
  try {
    return tool.describe(args);
  } catch {
    return tool.title;
  }
}
