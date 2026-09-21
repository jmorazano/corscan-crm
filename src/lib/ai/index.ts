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

/** Formatos de audio que OpenRouter acepta en `input_audio` (docs, sep-2026). */
export type AudioFormat = "wav" | "mp3" | "aiff" | "aac" | "ogg" | "flac" | "m4a";

/** Parte de contenido multimodal (015): texto o audio base64. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "input_audio"; input_audio: { data: string; format: AudioFormat } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

/**
 * Modelo de transcripción por defecto (015): tiene que aceptar entrada de
 * audio; NUNCA se cae al modelo del agente (puede no aceptarla).
 */
export const DEFAULT_TRANSCRIPTION_MODEL = "google/gemini-2.5-flash";

/** Config de IA resuelta por empresa (defaults de producto ya aplicados). */
export type AiConfig = {
  token: string;
  model: string;
  judgeModel: string;
  /** 015: modelo con entrada de audio; ausente = DEFAULT_TRANSCRIPTION_MODEL. */
  transcriptionModel?: string;
};

export type ChatJsonResult<T> =
  | { ok: true; data: T; raw: string }
  | { ok: false; error: "not_configured" | "provider_error" | "invalid_output"; detail: string };

/** Error HTTP del proveedor con su status (para clasificar sin regex frágil). */
export class ProviderHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

/**
 * Tope de tokens de salida por llamada. Sin `max_tokens`, OpenRouter reserva
 * el máximo del modelo (p. ej. 16k en gpt-4o) y rechaza con 402 a cualquier
 * cuenta cuyo saldo no cubra esa reserva, aunque la respuesta real sea un
 * JSON de pocas líneas. El agente devuelve UNA acción (texto de chat breve);
 * el juez, un veredicto con hallazgos: ambos caben holgados en estos topes.
 */
export const DEFAULT_MAX_TOKENS_AGENT = 1024;
export const DEFAULT_MAX_TOKENS_JUDGE = 2048;

export async function chatJson<T>(
  config: AiConfig,
  /** Input `unknown`: admite esquemas con preprocess (normalización previa). */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  messages: ChatMessage[],
  opts?: {
    model?: string;
    judge?: boolean;
    timeoutMs?: number;
    maxTokens?: number;
  }
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
  const maxTokens =
    opts?.maxTokens ??
    (opts?.judge ? DEFAULT_MAX_TOKENS_JUDGE : DEFAULT_MAX_TOKENS_AGENT);

  let lastDetail = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptMessages: ChatMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "system",
              content: `STRICT: tu respuesta anterior no fue JSON válido según el esquema (${truncate(lastDetail, 400)}). Responde ÚNICAMENTE el objeto JSON con la forma exacta indicada, sin explicaciones ni markdown.`,
            },
          ];
    try {
      const raw = await callProvider(
        config.token,
        model,
        attemptMessages,
        maxTokens,
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
  maxTokens: number,
  timeoutMs = 60_000,
  extra: Record<string, unknown> = {}
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
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, ...extra }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // El body es del proveedor: algunos ecoan la API key en sus errores
      // (p. ej. un 401 estilo OpenAI). Se redacta antes de que el detail
      // llegue a cualquier log (Constitución I).
      throw new ProviderHttpError(
        res.status,
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

export type TranscribeResult =
  | { ok: true; text: string }
  | {
      ok: false;
      error: "not_configured" | "unsupported_audio" | "provider_error" | "empty";
      detail: string;
    };

const TRANSCRIBE_MAX_ATTEMPTS = 2;
export const TRANSCRIPTION_TIMEOUT_MS = 90_000;
export const DEFAULT_MAX_TOKENS_TRANSCRIPTION = 2048;
/** Tope de la transcripción (mismo que el texto libre del composer). */
const TRANSCRIPTION_MAX_CHARS = 4096;
const EMPTY_SENTINEL = "[SIN_CONTENIDO]";

/**
 * Transcripción de una nota de voz (015, D9) por el MISMO proveedor
 * OpenRouter-compatible con un modelo multimodal (`input_audio` base64).
 * Salida en texto plano (no JSON). Reintenta solo ante red/timeout/5xx/429;
 * un 4xx que hable de audio/modalidad → `unsupported_audio` (el modelo
 * configurado no acepta audio). El base64 jamás llega a `detail` ni a logs.
 */
export async function transcribeAudio(
  config: AiConfig,
  audio: { bytes: Buffer | Uint8Array; format: AudioFormat },
  opts?: { model?: string; timeoutMs?: number; maxTokens?: number }
): Promise<TranscribeResult> {
  if (!config.token.trim()) {
    return { ok: false, error: "not_configured", detail: "La empresa no tiene token de IA" };
  }
  const model = (opts?.model ?? config.transcriptionModel ?? DEFAULT_TRANSCRIPTION_MODEL).trim();
  if (!model) {
    return { ok: false, error: "not_configured", detail: "Sin modelo de transcripción" };
  }
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "Sos un transcriptor de notas de voz cortas que el dueño de un negocio le manda a su asistente (español rioplatense por defecto).",
        "Devolvé ÚNICAMENTE la transcripción literal de lo que se dice, sin comillas, sin comentarios, sin marcas de tiempo ni etiquetas de hablante.",
        `Si el audio está en silencio, es ruido, es demasiado corto o no se entiende, devolvé exactamente ${EMPTY_SENTINEL}. NUNCA inventes ni completes frases que no se escuchan.`,
      ].join(" "),
    },
    {
      role: "user",
      content: [
        { type: "text", text: "Transcribí este audio." },
        {
          type: "input_audio",
          input_audio: { data: Buffer.from(audio.bytes).toString("base64"), format: audio.format },
        },
      ],
    },
  ];

  let lastDetail = "";
  for (let attempt = 1; attempt <= TRANSCRIBE_MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await callProvider(
        config.token,
        model,
        messages,
        opts?.maxTokens ?? DEFAULT_MAX_TOKENS_TRANSCRIPTION,
        opts?.timeoutMs ?? TRANSCRIPTION_TIMEOUT_MS,
        { temperature: 0 }
      );
      const text = cleanTranscription(raw);
      if (!text || /^\[?\s*sin[_ ]contenido\s*\]?$/i.test(text)) {
        return { ok: false, error: "empty", detail: "audio sin habla reconocible" };
      }
      return { ok: true, text: text.slice(0, TRANSCRIPTION_MAX_CHARS) };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      if (err instanceof ProviderHttpError) {
        const { status } = err;
        if (
          [400, 404, 415, 422].includes(status) &&
          /audio|modalit|input_audio|not support|unsupported|no soport/i.test(lastDetail)
        ) {
          return { ok: false, error: "unsupported_audio", detail: lastDetail };
        }
        if (status >= 400 && status < 500 && status !== 429) {
          return { ok: false, error: "provider_error", detail: lastDetail };
        }
      }
      if (attempt < TRANSCRIBE_MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  return { ok: false, error: "provider_error", detail: lastDetail };
}

/** Quita comillas envolventes, fences y saltos de línea Windows. */
function cleanTranscription(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n").trim();
  const fence = t.match(/^```[a-z]*\s*([\s\S]*?)```$/i);
  if (fence?.[1]) t = fence[1].trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("«") && t.endsWith("»"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
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
