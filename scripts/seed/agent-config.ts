/**
 * Importa el comportamiento del agente y el knowledge base de UNA empresa
 * desde un archivo JSON (ver `scripts/seed/agents/*.json`).
 *
 *   pnpm seed:agent --file=scripts/seed/agents/corscan-ingenieria.json [--org=<slug|nombre>] [--dry-run]
 *
 * Efecto: actualiza el perfil del agente (nombre, tono, instrucciones, reglas
 * de escalado, saludo) y REEMPLAZA el knowledge base completo de la
 * organización (borra las entradas existentes e inserta las del archivo, en
 * el orden del archivo). No toca `enabled`, contactos, conversaciones,
 * etapas ni corridas del Laboratorio. Re-ejecutable: correrlo dos veces con
 * el mismo archivo deja el mismo estado.
 *
 * Con una sola organización no hace falta --org. Con varias, lista las
 * disponibles si no se indica. Se bundlea con esbuild (alias @ → ./src).
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";
import { renderKb } from "@/server/ai/prompts";

/** Mismos límites que /api/agent/profile y /api/kb (fuente de verdad: esas rutas). */
const ConfigSchema = z.object({
  profile: z.object({
    name: z.string().trim().min(1).max(60),
    tone: z.string().max(500).nullable().optional(),
    instructions: z.string().max(8000).nullable().optional(),
    escalationRules: z.string().max(4000).nullable().optional(),
    greeting: z.string().max(1000).nullable().optional(),
  }),
  kb: z.array(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("qa"),
        question: z.string().trim().min(1).max(500),
        answer: z.string().trim().min(1).max(4000),
      }),
      z.object({
        kind: z.literal("block"),
        content: z.string().trim().min(1).max(8000),
      }),
    ])
  ),
});

/** Umbral de aviso del contador de la UI (/api/kb/size). */
const WARN_CHARS = 24_000;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function loadEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const env = readFileSync(".env", "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim();
  } catch {
    return undefined;
  }
}

const file = arg("file");
if (!file) {
  console.error(
    "[seed:agent] Falta --file=<ruta.json> (p. ej. scripts/seed/agents/corscan-ingenieria.json)"
  );
  process.exit(1);
}

const parsed = ConfigSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
if (!parsed.success) {
  console.error("[seed:agent] El archivo no respeta los límites del CRM:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}
const config = parsed.data;

const url = loadEnvVar("DATABASE_URL");
if (!url) {
  console.error("[seed:agent] DATABASE_URL no está definida");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql, { schema });

const orgs = await db
  .select({
    id: schema.organization.id,
    name: schema.organization.name,
    slug: schema.organization.slug,
  })
  .from(schema.organization);

const wanted = arg("org")?.trim().toLowerCase();
const org = wanted
  ? orgs.find(
      (o) => o.slug?.toLowerCase() === wanted || o.name.toLowerCase() === wanted
    )
  : orgs.length === 1
    ? orgs[0]
    : undefined;

if (!org) {
  console.error(
    wanted
      ? `[seed:agent] No hay una organización con slug o nombre "${wanted}".`
      : orgs.length === 0
        ? "[seed:agent] No hay organizaciones: regístrate primero en la app."
        : "[seed:agent] Hay varias organizaciones; indica --org=<slug|nombre>:"
  );
  for (const o of orgs) console.error(`  - ${o.name} (slug: ${o.slug ?? "—"})`);
  await sql.end();
  process.exit(1);
}

const kbChars = renderKb(
  config.kb.map((e, i) => ({
    id: `preview_${i}`,
    organizationId: org.id,
    kind: e.kind,
    question: e.kind === "qa" ? e.question : null,
    answer: e.kind === "qa" ? e.answer : null,
    content: e.kind === "block" ? e.content : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }))
).length;
const qaCount = config.kb.filter((e) => e.kind === "qa").length;
const blockCount = config.kb.length - qaCount;

console.log(
  `[seed:agent] Empresa: ${org.name} · agente "${config.profile.name}" · KB: ${qaCount} P/R + ${blockCount} bloques = ${kbChars.toLocaleString("es-AR")} caracteres${kbChars >= WARN_CHARS ? " (¡supera el umbral de aviso de la UI!)" : ""}`
);

if (process.argv.includes("--dry-run")) {
  console.log("[seed:agent] --dry-run: no se escribió nada.");
  await sql.end();
  process.exit(0);
}

await db.transaction(async (tx) => {
  const existing = await tx
    .select({ id: schema.agentProfile.id })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, org.id))
    .limit(1);
  if (!existing[0]) {
    await tx
      .insert(schema.agentProfile)
      .values({ id: newId("agentProfile"), organizationId: org.id });
  }
  await tx
    .update(schema.agentProfile)
    .set({
      name: config.profile.name,
      tone: config.profile.tone ?? null,
      instructions: config.profile.instructions ?? null,
      escalationRules: config.profile.escalationRules ?? null,
      greeting: config.profile.greeting ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.agentProfile.organizationId, org.id));

  const deleted = await tx
    .delete(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, org.id))
    .returning({ id: schema.kbEntry.id });

  // La UI ordena por created_at ascendente: un offset por entrada preserva el
  // orden del archivo aunque el insert sea en la misma transacción.
  const base = Date.now();
  if (config.kb.length > 0) {
    await tx.insert(schema.kbEntry).values(
      config.kb.map((e, i) => ({
        id: newId("kbEntry"),
        organizationId: org.id,
        kind: e.kind,
        question: e.kind === "qa" ? e.question : null,
        answer: e.kind === "qa" ? e.answer : null,
        content: e.kind === "block" ? e.content : null,
        createdAt: new Date(base + i),
        updatedAt: new Date(base + i),
      }))
    );
  }
  console.log(
    `[seed:agent] Listo: perfil actualizado, ${deleted.length} entradas previas reemplazadas por ${config.kb.length}.`
  );
});

await sql.end();
process.exit(0);
