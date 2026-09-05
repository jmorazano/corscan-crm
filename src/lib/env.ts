import { z } from "zod";

/**
 * Validación central del entorno.
 *
 * Lazy + memoizada: se evalúa en el primer uso en runtime, nunca al importar.
 * Durante `next build` no hay secretos (la imagen se construye sin ellos), así
 * que en esa fase se aceptan placeholders — los valores reales llegan al boot.
 */

const envSchema = z.object({
  APP_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message:
        "ENCRYPTION_KEY debe ser 32 bytes en base64 (genera con: openssl rand -base64 32)",
    }),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(8),
  META_APP_SECRET: z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_ES_CONFIG_ID: z.string().optional(),
  META_ES_COEX_CONFIG_ID: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().default("v25.0"),
  META_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  // OPENROUTER_API_TOKEN / OPENROUTER_MODEL / OPENROUTER_JUDGE_MODEL: fuera
  // del schema desde 003-multitenancy (US3): el token y los modelos son POR
  // EMPRESA y viven cifrados en la tabla ai_credentials (Ajustes →
  // Inteligencia artificial). Solo la base del proveedor sigue siendo de
  // instancia (transporte del adaptador; interceptada por el ai-mock).
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api"),
  ALLOW_SIGNUP: z.string().optional(),
  SUPER_ADMIN_EMAILS: z.string().optional(),
  AGENT_COALESCE_MS: z.coerce.number().int().min(0).default(6000),
  WA_MOCK_ENABLED: z.string().optional(),
  DEMO_TOOLS_ENABLED: z.string().optional(),
  COEXISTENCE_UI_ENABLED: z.string().optional(),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof envSchema>;

const BUILD_PLACEHOLDERS: Record<string, string> = {
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://build:build@localhost:5432/build",
  BETTER_AUTH_SECRET: "placeholder-build-secret",
  ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  META_WEBHOOK_VERIFY_TOKEN: "placeholder-verify-token",
};

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  // Los strings vacíos cuentan como ausentes: los compose/paneles suelen
  // inyectar VAR="" para opcionales y eso debe activar los defaults.
  const source = isBuild
    ? { ...BUILD_PLACEHOLDERS, ...stripEmpty(process.env) }
    : stripEmpty(process.env);
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(
      `Variables de entorno inválidas o faltantes:\n  ${missing}\n` +
        "Revisa .env.example para la guía de cada variable."
    );
  }
  cached = parsed.data;
  return cached;
}

function stripEmpty(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

/** true si el entorno de pruebas interno (mocks) está habilitado y NO es producción. */
export function isMockEnabled(): boolean {
  return (
    process.env.WA_MOCK_ENABLED === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

/**
 * true si las herramientas de demo están habilitadas (DEMO_TOOLS_ENABLED).
 * A diferencia de los mocks, esto SÍ puede activarse en producción: sirve para
 * recargar el negocio de ejemplo mientras se prepara o se muestra la
 * instancia. Apagarlo hace desaparecer la pestaña y bloquea la recarga
 * forzada, que es destructiva.
 */
export function isDemoToolsEnabled(): boolean {
  return process.env.DEMO_TOOLS_ENABLED === "true";
}

/**
 * true si Embedded Signup está configurado: hacen falta las tres piezas
 * (app id y config id van al browser; el secret solo se usa en el servidor
 * para intercambiar el `code`). Sin las tres, la UI cae al modo manual.
 */
export function isEmbeddedSignupConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.META_APP_ID && env.META_ES_CONFIG_ID && env.META_APP_SECRET);
}

/**
 * true si la opción de coexistence ("Conectar sin perder el celular") debe
 * mostrarse. Apagada por defecto: el flujo requiere estatus de Tech Provider
 * aprobado por Meta, y hasta entonces el popup falla al final — un botón
 * visible que termina en error lee como "app incompleta" en el App Review.
 * En el mock de self-test se muestra siempre, para poder probar el flujo.
 */
export function isCoexistenceUiEnabled(): boolean {
  return process.env.COEXISTENCE_UI_ENABLED === "true" || isMockEnabled();
}
