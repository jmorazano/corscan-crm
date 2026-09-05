import type { z } from "zod";
import { getEnv } from "@/lib/env";

/**
 * Adaptador LLM OpenRouter-compatible — ÚNICA frontera con el proveedor de IA
 * (Constitución II). Regla operativa: la salida del modelo es impredecible;
 * todo consumo pasa por extracción robusta + Zod + reintentos, y un hipo del
 * proveedor jamás propaga excepción (resultado `error` tipado).
 *
 * Multitenancy (US3, contrato ai-settings.md): el token y los modelos son POR
 * EMPRESA — llegan resueltos en `AiConfig` vía getAiConfig(organizationId).
 * Este módulo NO lee OPENROUTER_API_TOKEN/MODEL/JUDGE_MODEL del env; solo
 * OPENROUTER_BASE_URL sigue siendo de instancia (transporte del adaptador,
 * interceptado por el ai-mock en el self-test).
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Config de IA resuelta por empresa (defaults de producto ya aplicados). */
export type AiConfig = {
  token: string;
  model: string;
  judgeModel: string;
};

export type ChatJsonResult<T> =
  | { ok: true; data: T; raw: string }
  | { ok: false; error: "not_configured" | "provider_error" | "invalid_output"; detail: string };

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export async function chatJson<T>(
  config: AiConfig,
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts?: { model?: string; judge?: boolean; timeoutMs?: number }
): Promise<ChatJsonResult<T>> {
  // Cinturón: los callers cortan antes con getAiConfig — pero si llegara una
  // config vacía, el resultado es el error tipado, jamás una excepción.
  if (!config.token.trim()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "La empresa no tiene token de IA configurado",
    };
  }
  const model =
    opts?.model ?? (opts?.judge ? config.judgeModel : config.model);
  if (!model?.trim()) {
    return {
      ok: false,
      error: "not_configured",
      detail: "La empresa no tiene modelo de IA resuelto",
    };
  }

  let lastDetail = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptMessages: ChatMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "system",
              content:
                "STRICT: tu respuesta anterior no fue JSON válido según el esquema. Responde ÚNICAMENTE el objeto JSON, sin explicaciones ni markdown.",
            },
          ];
    try {
      const raw = await callProvider(
        config.token,
        model,
        attemptMessages,
        opts?.timeoutMs
      );
      const extracted = extractJson(raw);
      if (extracted === null) {
        lastDetail = `sin JSON extraíble (raw=${truncate(raw)})`;
        continue;
      }
      const parsed = schema.safeParse(extracted);
      if (!parsed.success) {
        lastDetail = `no cumple el esquema: ${parsed.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; ")} (raw=${truncate(raw)})`;
        continue;
      }
      return { ok: true, data: parsed.data, raw };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  return {
    ok: false,
    error: lastDetail.includes("esquema") || lastDetail.includes("JSON")
      ? "invalid_output"
      : "provider_error",
    detail: lastDetail,
  };
}

async function callProvider(
  token: string,
  model: string,
  messages: ChatMessage[],
  timeoutMs = 60_000
): Promise<string> {
  const env = getEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.OPENROUTER_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        // El token (de la empresa) jamás se loguea; solo viaja en este header.
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // El body es del proveedor: algunos ecoan la API key en sus errores
      // (p. ej. un 401 estilo OpenAI). Se redacta antes de que el detail
      // llegue a cualquier log (Constitución I).
      throw new Error(
        `proveedor respondió ${res.status}: ${truncate(redactSecrets(text))}`
      );
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("respuesta del proveedor sin contenido");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracción robusta de JSON de una respuesta de modelo:
 * 1) bloque ```json ... ``` (o ``` ... ```), 2) el texto completo,
 * 3) del primer `{` al último `}`.
 */
export function extractJson(raw: string): unknown | null {
  const candidates: string[] = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(raw.trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** Redacta posibles API keys (sk-…, sk-or-…) de un texto ajeno. */
function redactSecrets(s: string): string {
  return s.replace(/sk-[A-Za-z0-9_-]{4,}/g, "sk-***");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
