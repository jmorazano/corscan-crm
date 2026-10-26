import { desc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import { DEFAULT_METRICS_TIMEZONE } from "@/lib/metrics";
import { foldAccents } from "@/lib/assistants/format";
import {
  checkTeachChange,
  extractContactKeys,
  extractDottedTokens,
  extractHosts,
  changeTexts,
  type KnownEntry,
} from "@/lib/assistants/teach-guard";
import { appendToField, type TrainerChangeType } from "@/server/ai/trainer-actions";
import { getProfile, PROFILE_LIMITS, type AgentProfile } from "@/server/ai/profile";
import { KB_LIMITS, listEntries, type DbOrTx, type KbEntry } from "@/server/kb/service";
import {
  applyTrainerChanges,
  ChangeError,
  revertChange,
  serializeChange,
  type ChangeDto,
} from "@/server/trainer/changes";
import { ToolInputError, ToolNotFoundError } from "./tools/common";

/**
 * ÚNICA escritura del servidor MCP de los asistentes (041, constitución
 * 1.14.0): enseñarle al agente de una empresa. Reutiliza el motor del
 * Entrenador (015) con origen `assistant`; antes de aplicar corren las
 * guardas deterministas (`teach-guard.ts`), el chequeo de datos de contactos
 * y el tope por hora, todo dentro de una transacción con lock por empresa.
 */

export const MAX_ASSISTANT_CHANGES_PER_HOUR = 30;
export const KNOWLEDGE_SNIPPET_CHARS = 600;
export const KNOWLEDGE_MAX_ENTRIES = 200;

type ProfileField = "name" | "tone" | "instructions" | "escalationRules" | "greeting";

// ------------------------------------------------------------------ lectura

export type KnowledgeEntryDto = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
  source: KbEntry["source"];
  created_at: string;
  updated_at: string;
  truncated: boolean;
};

function clip(text: string | null, full: boolean): { text: string | null; cut: boolean } {
  if (text === null || full || text.length <= KNOWLEDGE_SNIPPET_CHARS) return { text, cut: false };
  return { text: `${text.slice(0, KNOWLEDGE_SNIPPET_CHARS - 1)}…`, cut: true };
}

function profileDto(p: AgentProfile | null) {
  if (!p) return null;
  return {
    name: p.name,
    tone: p.tone ?? null,
    instructions: p.instructions ?? null,
    escalation_rules: p.escalationRules ?? null,
    greeting: p.greeting ?? null,
  };
}

export async function readAgentKnowledge(
  organizationId: string,
  opts: { query?: string; ids?: readonly string[] }
) {
  const db = getDb();
  const [profile, all] = await Promise.all([getProfile(organizationId, db), listEntries(organizationId, db)]);
  const full = (opts.ids?.length ?? 0) > 0;
  let entries = all;
  if (full) {
    const wanted = new Set(opts.ids);
    entries = all.filter((e) => wanted.has(e.id));
  } else if (opts.query?.trim()) {
    const needle = foldAccents(opts.query.trim()).toLowerCase();
    entries = all.filter((e) =>
      [e.question, e.answer, e.content].some((t) => t && foldAccents(t).toLowerCase().includes(needle))
    );
  }
  const total = entries.length;
  const page = entries.slice(0, KNOWLEDGE_MAX_ENTRIES);
  let anyCut = false;
  const out: KnowledgeEntryDto[] = page.map((e) => {
    const q = clip(e.question, full);
    const a = clip(e.answer, full);
    const c = clip(e.content, full);
    const truncated = q.cut || a.cut || c.cut;
    anyCut ||= truncated;
    return {
      id: e.id,
      kind: e.kind,
      question: q.text,
      answer: a.text,
      content: c.text,
      source: e.source,
      created_at: e.createdAt.toISOString(),
      updated_at: e.updatedAt.toISOString(),
      truncated,
    };
  });
  const notes: string[] = [];
  if (anyCut) notes.push(`Textos recortados a ${KNOWLEDGE_SNIPPET_CHARS} caracteres; pedí ids para verlos completos.`);
  if (total > page.length) notes.push(`Hay ${total} entradas y se muestran ${page.length}: filtrá con query.`);
  if (full && page.length < (opts.ids?.length ?? 0)) notes.push("Algunos ids no existen en esta empresa.");
  return {
    profile: profileDto(profile),
    knowledge: { total, returned: out.length, entries: out },
    limits: {
      question: KB_LIMITS.question,
      answer: KB_LIMITS.answer,
      content: KB_LIMITS.content,
      name: PROFILE_LIMITS.name,
      tone: PROFILE_LIMITS.tone,
      instructions: PROFILE_LIMITS.instructions,
      escalation_rules: PROFILE_LIMITS.escalationRules,
      greeting: PROFILE_LIMITS.greeting,
    },
    note: notes.length > 0 ? notes.join(" ") : null,
  };
}

// ---------------------------------------------------------------- enseñanza

export type TeachKind = "teach" | "edit";
const OPS_BY_KIND: Record<TeachKind, readonly TrainerChangeType["op"][]> = {
  teach: ["kb_add", "profile_append"],
  edit: ["kb_update", "kb_delete", "profile_set"],
};

export type TeachOutcome = {
  applied: { change_id: string; op: TrainerChangeType["op"]; target_id: string | null; summary: string }[];
  rejected: { index: number; op: TrainerChangeType["op"]; reason: string }[];
  remaining_this_hour: number;
};

const ML_DOMAINS: Record<string, string> = {
  MLA: "mercadolibre.com.ar",
  MLM: "mercadolibre.com.mx",
  MLB: "mercadolivre.com.br",
  MLU: "mercadolibre.com.uy",
  MLC: "mercadolibre.cl",
  MCO: "mercadolibre.com.co",
  MPE: "mercadolibre.com.pe",
};

function hostOf(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Hosts que el agente ya puede nombrar: el CRM, lo que está en su conocimiento y sus integraciones. */
async function allowedHostsFor(organizationId: string, corpus: string, db: DbOrTx): Promise<string[]> {
  // Los enlaces del corpus y sus dominios sueltos («altos.com» deja pasar «reservas.altos.com»).
  const hosts = new Set<string>([...extractHosts(corpus), ...extractDottedTokens(corpus)]);
  const crm = hostOf(getEnv().APP_BASE_URL);
  if (crm) hosts.add(crm);
  const [mcp, meli] = await Promise.all([
    db
      .select({ endpointUrl: schema.mcpIntegration.endpointUrl, providerConfig: schema.mcpIntegration.providerConfig })
      .from(schema.mcpIntegration)
      .where(scoped(schema.mcpIntegration.organizationId, organizationId)),
    db
      .select({ siteId: schema.meliIntegration.siteId })
      .from(schema.meliIntegration)
      .where(scoped(schema.meliIntegration.organizationId, organizationId)),
  ]);
  for (const row of mcp) {
    const endpoint = hostOf(row.endpointUrl);
    if (endpoint) hosts.add(endpoint);
    const engine = hostOf(row.providerConfig?.bookingEngineUrl);
    if (engine) hosts.add(engine);
  }
  for (const row of meli) {
    const domain = ML_DOMAINS[row.siteId];
    if (domain) hosts.add(domain);
  }
  return [...hosts];
}

function corpusOf(profile: AgentProfile | null, entries: readonly KbEntry[]): string {
  const parts: (string | null | undefined)[] = [];
  if (profile) parts.push(profile.name, profile.tone, profile.instructions, profile.escalationRules, profile.greeting);
  for (const e of entries) parts.push(e.question, e.answer, e.content);
  return parts.filter(Boolean).join("\n");
}

/** Últimos 10 dígitos: «+54 9 351 …» y «351 …» son el mismo teléfono (regla AR del 9). */
function phoneTail(digits: string): string {
  return digits.replace(/\D/g, "").slice(-10);
}

/**
 * ¿El cambio contiene el teléfono, el correo o el usuario de Instagram de un
 * contacto de la empresa? Cubre el caso en que ese dato ya se coló en el
 * conocimiento (y por eso pasaría la guarda de corpus).
 */
async function contactMatch(organizationId: string, texts: readonly string[], db: DbOrTx): Promise<string | null> {
  const keys = { phones: new Set<string>(), emails: new Set<string>(), handles: new Set<string>() };
  for (const t of texts) {
    const k = extractContactKeys(t);
    k.phones.forEach((p) => keys.phones.add(phoneTail(p)));
    k.emails.forEach((e) => keys.emails.add(e));
    k.handles.forEach((h) => keys.handles.add(h));
  }
  const c = schema.contact;
  const checks = [];
  if (keys.phones.size > 0) {
    const tails = [...keys.phones];
    checks.push(
      sql`right(regexp_replace(${c.phone}, '\\D', '', 'g'), 10) in (${sql.join(tails.map((t) => sql`${t}`), sql`, `)})`,
      sql`right(regexp_replace(coalesce(${c.contactPhone}, ''), '\\D', '', 'g'), 10) in (${sql.join(tails.map((t) => sql`${t}`), sql`, `)})`
    );
  }
  if (keys.emails.size > 0) {
    checks.push(sql`lower(${c.email}) in (${sql.join([...keys.emails].map((e) => sql`${e}`), sql`, `)})`);
  }
  if (keys.handles.size > 0) {
    checks.push(sql`lower(${c.igUsername}) in (${sql.join([...keys.handles].map((h) => sql`${h}`), sql`, `)})`);
  }
  if (checks.length === 0) return null;
  const rows = await db
    .select({ id: c.id })
    .from(c)
    .where(scoped(c.organizationId, organizationId, eq(c.isTest, false), sql`(${sql.join(checks, sql` or `)})`))
    .limit(1);
  return rows.length > 0 ? "Tiene un dato de un contacto (teléfono, correo o usuario): el conocimiento del agente no guarda datos de clientes." : null;
}

const FIELD_LIMIT: Record<ProfileField, number> = {
  name: PROFILE_LIMITS.name,
  tone: PROFILE_LIMITS.tone,
  instructions: PROFILE_LIMITS.instructions,
  escalationRules: PROFILE_LIMITS.escalationRules,
  greeting: PROFILE_LIMITS.greeting,
};

/** Topes de largo por campo (el motor del Entrenador confía en su Zod; acá se verifica el resultado). */
function lengthProblem(change: TrainerChangeType, profile: AgentProfile | null): string | null {
  const over = (text: string | null | undefined, max: number) => (text?.length ?? 0) > max;
  switch (change.op) {
    case "kb_add":
    case "kb_update":
      if (over(change.question, KB_LIMITS.question)) return `La pregunta supera el tope de ${KB_LIMITS.question} caracteres.`;
      if (over(change.answer, KB_LIMITS.answer)) return `La respuesta supera el tope de ${KB_LIMITS.answer} caracteres.`;
      if (over(change.content, KB_LIMITS.content)) return `El bloque supera el tope de ${KB_LIMITS.content} caracteres.`;
      return null;
    case "profile_set": {
      const max = FIELD_LIMIT[change.field];
      return over(change.value, max) ? `Supera el tope de ${max} caracteres del campo.` : null;
    }
    case "profile_append": {
      const max = FIELD_LIMIT[change.field];
      const next = appendToField((profile?.[change.field] as string | null | undefined) ?? null, change.text);
      return next.length > max ? `Con esta regla el campo superaría el tope de ${max} caracteres: resumilo o corregí el campo con edit_agent.` : null;
    }
    case "kb_delete":
      return null;
  }
}

function hourLabel(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: DEFAULT_METRICS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Aplica un pedido de `teach_agent`/`edit_agent` (research D2–D5). Un cambio
 * rechazado no aborta los demás; todos comparten la transacción y el lock.
 */
export async function applyAssistantChanges(
  organizationId: string,
  kind: TeachKind,
  changes: readonly TrainerChangeType[],
  now: Date = new Date()
): Promise<TeachOutcome> {
  const allowedOps = OPS_BY_KIND[kind];
  const wrong = changes.find((c) => !allowedOps.includes(c.op));
  if (wrong) {
    throw new ToolInputError(
      kind === "teach"
        ? `«${wrong.op}» corrige o borra: usá edit_agent. teach_agent solo agrega (kb_add, profile_append).`
        : `«${wrong.op}» agrega: usá teach_agent. edit_agent solo corrige o borra (kb_update, kb_delete, profile_set).`
    );
  }

  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`assistant-teach:${organizationId}`}))`);

    const since = new Date(now.getTime() - HOUR_MS);
    const recent = await tx
      .select({ createdAt: schema.agentChange.createdAt })
      .from(schema.agentChange)
      .where(
        scoped(
          schema.agentChange.organizationId,
          organizationId,
          eq(schema.agentChange.source, "assistant"),
          gt(schema.agentChange.createdAt, sql`${since.toISOString()}::timestamp`)
        )
      )
      .orderBy(schema.agentChange.createdAt);
    let remaining = Math.max(0, MAX_ASSISTANT_CHANGES_PER_HOUR - recent.length);
    const retryAt = recent[0] ? new Date(recent[0].createdAt.getTime() + HOUR_MS) : new Date(now.getTime() + HOUR_MS);

    const [profile, entries] = await Promise.all([getProfile(organizationId, tx), listEntries(organizationId, tx)]);
    const corpus = corpusOf(profile, entries);
    const allowedHosts = await allowedHostsFor(organizationId, corpus, tx);
    const knownEntries: KnownEntry[] = entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      question: e.question,
      answer: e.answer,
      content: e.content,
    }));

    const outcome: TeachOutcome = { applied: [], rejected: [], remaining_this_hour: remaining };
    for (const [index, change] of changes.entries()) {
      const reject = (reason: string) => outcome.rejected.push({ index, op: change.op, reason });
      if (remaining <= 0) {
        reject(`Tope de ${MAX_ASSISTANT_CHANGES_PER_HOUR} cambios por hora desde Claude: volvé a probar desde las ${hourLabel(retryAt)}.`);
        continue;
      }
      const tooLong = lengthProblem(change, profile);
      if (tooLong) {
        reject(tooLong);
        continue;
      }
      const texts = changeTexts(change);
      const contact = texts.length > 0 ? await contactMatch(organizationId, texts, tx) : null;
      if (contact) {
        reject(contact);
        continue;
      }
      const verdict = checkTeachChange(change, { corpus, allowedHosts, knownEntries });
      if (!verdict.ok) {
        reject(verdict.reason);
        continue;
      }
      const result = await applyTrainerChanges(
        tx,
        { organizationId, conversationId: null, messageId: null, source: "assistant" },
        [change]
      );
      const applied = result.applied[0];
      if (!applied) {
        reject(friendlyEngineReason(result.rejected[0]?.reason));
        continue;
      }
      remaining -= 1;
      outcome.applied.push({ change_id: applied.id, op: change.op, target_id: applied.targetId, summary: applied.summary });
      // Lo recién enseñado cuenta para las guardas de los cambios siguientes del mismo pedido.
      if (change.op === "kb_add") {
        knownEntries.push({
          id: applied.targetId ?? "",
          kind: change.kind,
          question: change.question ?? null,
          answer: change.answer ?? null,
          content: change.content ?? null,
        });
      }
    }
    outcome.remaining_this_hour = remaining;
    return outcome;
  });
}

function friendlyEngineReason(reason: string | undefined): string {
  if (!reason) return "No se pudo aplicar ese cambio.";
  if (/no hay perfil/i.test(reason) || /perfil del agente no encontrado/i.test(reason)) {
    return "La empresa no tiene agente configurado: crealo desde Agente en el CRM.";
  }
  if (/no encontrad/i.test(reason)) return "Entrada no encontrada en esta empresa.";
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

// ------------------------------------------------------------- deshacer/listar

export type ChangeListItem = {
  change_id: string;
  op: ChangeDto["op"];
  target_id: string | null;
  summary: string;
  source: string;
  created_at: string;
  reverted_at: string | null;
  can_undo_here: boolean;
};

function listItem(c: ChangeDto): ChangeListItem {
  return {
    change_id: c.id,
    op: c.op,
    target_id: c.targetId,
    summary: c.summary,
    source: c.source,
    created_at: c.createdAt,
    reverted_at: c.revertedAt,
    can_undo_here: c.source === "assistant" && c.revertedAt === null,
  };
}

export async function listAgentChanges(
  organizationId: string,
  opts: { source: "assistant" | "all"; limit: number }
): Promise<ChangeListItem[]> {
  const t = schema.agentChange;
  const rows = await getDb()
    .select()
    .from(t)
    .where(scoped(t.organizationId, organizationId, opts.source === "assistant" ? eq(t.source, "assistant") : undefined))
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(opts.limit);
  return rows.map((r) => listItem(serializeChange(r)));
}

/** Deshace un cambio hecho DESDE CLAUDE (research D6); los demás se deshacen en el CRM. */
export async function undoAssistantChange(organizationId: string, changeId: string, userId: string): Promise<ChangeListItem> {
  const t = schema.agentChange;
  const rows = await getDb()
    .select({ source: t.source })
    .from(t)
    .where(scoped(t.organizationId, organizationId, eq(t.id, changeId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new ToolNotFoundError(`No encontré el cambio «${changeId}» en esta empresa.`);
  if (row.source !== "assistant") {
    throw new ToolInputError("Ese cambio se hizo desde el CRM: deshacelo desde el panel del Entrenador en la Bandeja.");
  }
  try {
    return listItem(await revertChange(organizationId, changeId, userId));
  } catch (err) {
    if (err instanceof ChangeError) {
      if (err.code === "already_reverted") throw new ToolInputError("Ese cambio ya estaba deshecho.");
      if (err.code === "not_found") throw new ToolNotFoundError(`No encontré el cambio «${changeId}» en esta empresa.`);
      throw new ToolInputError(`No se puede deshacer sin pisar otro cambio: ${err.message}.`);
    }
    throw err;
  }
}

