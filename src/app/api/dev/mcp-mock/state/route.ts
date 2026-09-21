import { z } from "zod";
import { parseBody } from "@/lib/api";
import { mockGuard } from "@/lib/dev-guard";
import { ventanaDisponibilidad, MCP_MOCK_TOOL_NAMES } from "../engine";
import { MCP_MOCK_PROPERTIES } from "../data";
import { getMcpMockState, resetMcpMockState } from "../state";

/**
 * Inspección y control del mcp-mock (016), en el estilo de
 * `google-mock/state` y `wa-mock/knobs`.
 *
 *  GET    → { knobs, calls, availabilityWindow, tools, properties }
 *  POST   → enciende/apaga knobs (Zod; acepta los nombres del diseño y los
 *           alias cortos del harness)
 *  DELETE → reset total (knobs + bitácora)
 *
 * `calls` es la BITÁCORA EN MEMORIA de todo lo que recibió el mock. Con ella el
 * guion E2E prueba lo que de otro modo sería indemostrable: que una conversación
 * `is_test` del Laboratorio NO genera tráfico al PMS (SC-003 / corrección #25).
 * Se limpia el log, se corre el Laboratorio entero y se exige `calls: []`.
 *
 * Ojo: el reset NO borra la credencial guardada en la fila de la empresa (a
 * diferencia del google-mock, que sí invalida sus tokens). El mock no conoce
 * ninguna credencial: acepta cualquier valor no vacío.
 */

export const dynamic = "force-dynamic";

const MALFORMED = [
  "not-json",
  "no-content",
  "rpc-error",
  "truncated",
  "bad-json-body",
] as const;

const bodySchema = z.object({
  /** Un disparo: el próximo `tools/call` → isError + `unauthorized`. */
  nextUnauthorized: z.boolean().optional(),
  /** Un disparo: HTTP 500 (caída de transporte). */
  failNextCall: z.boolean().optional(),
  /** Un disparo: HTTP 307 — el transporte no debe seguirla (corrección #56). */
  redirectNext: z.boolean().optional(),
  /** Un disparo: devuelve ese código estable (`unknown_city`, `invalid_guests`…). */
  forceError: z.string().max(64).nullable().optional(),
  /** Un disparo: rompe la respuesta de la forma indicada. */
  malformedNext: z.enum(MALFORMED).nullable().optional(),
  /** Persistente: demora antes de responder (ejercita timeout/abort). */
  delayMs: z.number().int().min(0).max(120_000).optional(),
  /** Persistente: `check-availability` devuelve `properties: []`. */
  emptyResults: z.boolean().optional(),
  /** Persistente: ~2 MB de relleno (ejercita el tope de bytes). */
  hugeResponse: z.boolean().optional(),
  /** Persistente: marcadores de prompt y enlaces fuera de dominio en el texto. */
  evilText: z.boolean().optional(),

  // Alias cortos, para que el guion pueda escribir el mismo vocabulario que
  // usa por query param (`?fail=timeout`) sin recordar dos nombres.
  unauthorized: z.boolean().optional(),
  internal_error: z.boolean().optional(),
  timeout: z.boolean().optional(),
  malformed: z.enum(MALFORMED).nullable().optional(),
  huge: z.boolean().optional(),

  /** Limpia solo la bitácora, sin tocar los knobs. */
  clearCalls: z.boolean().optional(),
});

/** Demora que usa el alias `timeout: true` (por encima de cualquier cliente). */
const DEMORA_TIMEOUT_MS = 30_000;

export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  const estado = getMcpMockState();
  return Response.json({
    knobs: estado.knobs,
    calls: estado.calls,
    // La ventana es RELATIVA A HOY: el guion toma de acá las fechas válidas en
    // vez de cablear un 2026 que caduca.
    availabilityWindow: ventanaDisponibilidad(),
    tools: [...MCP_MOCK_TOOL_NAMES],
    properties: MCP_MOCK_PROPERTIES.map((p) => ({
      code: p.code,
      city: p.city,
      capacity: p.capacity,
      bedrooms: p.bedrooms,
      pricePerNight: p.pricePerNight,
    })),
  });
}

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const d = body.data;
  const k = getMcpMockState().knobs;

  const nextUnauthorized = d.nextUnauthorized ?? d.unauthorized;
  if (nextUnauthorized !== undefined) k.nextUnauthorized = nextUnauthorized;

  const failNextCall = d.failNextCall ?? d.internal_error;
  if (failNextCall !== undefined) k.failNextCall = failNextCall;

  if (d.redirectNext !== undefined) k.redirectNext = d.redirectNext;
  if (d.forceError !== undefined) k.forceError = d.forceError;

  // `??` no sirve acá: `malformedNext: null` es una orden de APAGAR el knob.
  const malformedNext =
    d.malformedNext !== undefined ? d.malformedNext : d.malformed;
  if (malformedNext !== undefined) k.malformedNext = malformedNext;

  if (d.delayMs !== undefined) k.delayMs = d.delayMs;
  else if (d.timeout !== undefined) k.delayMs = d.timeout ? DEMORA_TIMEOUT_MS : 0;

  if (d.emptyResults !== undefined) k.emptyResults = d.emptyResults;

  const hugeResponse = d.hugeResponse ?? d.huge;
  if (hugeResponse !== undefined) k.hugeResponse = hugeResponse;

  if (d.evilText !== undefined) k.evilText = d.evilText;

  if (d.clearCalls) getMcpMockState().calls.length = 0;

  return Response.json({ knobs: k });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  resetMcpMockState();
  return Response.json({ cleared: true });
}
