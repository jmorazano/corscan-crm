import { z } from "zod/v4";
import type { GrantWorkspace } from "@/lib/assistants/authorize";
import {
  ASSISTANT_PERIODS,
  DEFAULT_METRICS_TIMEZONE,
  periodWindow,
  type PeriodWindow,
} from "@/lib/metrics";
import { isValidTimeZone } from "@/lib/time";
import type { AssistantCall } from "../access";

/**
 * Piezas comunes de las herramientas de los asistentes (040). Sin imports
 * del registro (`./index`) para que no haya ciclos al cargar los módulos.
 */

export type ToolContext = {
  call: AssistantCall;
  /** null solo en herramientas sin empresa (`list_workspaces`). */
  workspace: GrantWorkspace | null;
  now: Date;
};

export type ToolOutput = {
  data: Record<string, unknown>;
  /** Descripción para el registro cuando depende del resultado. */
  summary?: string;
};

export type AssistantTool = {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  needsWorkspace: boolean;
  /** Descripción en lenguaje claro para el registro (sin el contenido devuelto). */
  describe: (args: Record<string, unknown>) => string;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolOutput>;
};

/** El recurso pedido no existe en la empresa (o es de otra: misma respuesta). */
export class ToolNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolNotFoundError";
  }
}

/** Argumentos válidos en forma pero imposibles (rango de fechas, ambigüedad). */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/** Parámetro común de todas las herramientas con empresa. */
export const workspaceParam = z
  .string()
  .max(200)
  .optional()
  .describe(
    "Empresa: id (org_…) o nombre exacto, como lo devuelve list_workspaces. Se puede omitir si hay una sola empresa disponible."
  );

/** Parámetros de período compartidos (contracts/mcp-tools.md). */
export const periodParams = {
  period: z
    .enum(ASSISTANT_PERIODS)
    .optional()
    .describe(
      "Período predefinido. Default last_30_days. last_30_days, last_12_weeks y last_12_months son los mismos de la pantalla Métricas."
    ),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Inicio de un rango propio (AAAA-MM-DD, fecha local). Va con «to»; reemplaza a «period»."),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Fin del rango, inclusive (AAAA-MM-DD). Máximo 400 días."),
  timezone: z
    .string()
    .max(64)
    .optional()
    .describe("Zona horaria IANA para cortar los días. Default America/Argentina/Buenos_Aires."),
};

export function resolveTimeZone(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_METRICS_TIMEZONE;
  if (typeof raw !== "string" || !isValidTimeZone(raw)) {
    throw new ToolInputError(`Zona horaria desconocida: ${String(raw).slice(0, 64)}`);
  }
  return raw;
}

/** Ventana del período pedido o ToolInputError con el motivo en castellano. */
export function resolvePeriod(
  args: { period?: unknown; from?: unknown; to?: unknown; timezone?: unknown },
  now: Date
): { window: PeriodWindow; timeZone: string } {
  const timeZone = resolveTimeZone(args.timezone);
  const hasFrom = typeof args.from === "string";
  const hasTo = typeof args.to === "string";
  if (hasFrom !== hasTo) throw new ToolInputError("Para un rango propio mandá «from» y «to» juntos.");
  const out = hasFrom
    ? periodWindow({ from: args.from as string, to: args.to as string }, timeZone, now)
    : periodWindow(
        { period: (args.period as (typeof ASSISTANT_PERIODS)[number] | undefined) ?? "last_30_days" },
        timeZone,
        now
      );
  if (!out.ok) throw new ToolInputError(out.message);
  return { window: out.window, timeZone };
}
