import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  createEntry,
  deleteEntry,
  getEntry,
  KbError,
  restoreEntry,
  updateEntry,
  type DbOrTx,
  type KbEntry,
} from "@/server/kb/service";
import {
  getProfile,
  updateProfile,
  type AgentProfile,
  type ProfilePatch,
} from "@/server/ai/profile";
import {
  appendToField,
  type ProfileField,
  type TrainerChangeType,
} from "@/server/ai/trainer-actions";

/**
 * Aplicación y auditoría de los cambios del entrenador (015, D7): cada
 * cambio queda en `agent_change` con antes/después y un resumen legible
 * generado acá (no por el modelo), y se puede deshacer.
 */

export type ChangeOp = "kb_add" | "kb_update" | "kb_delete" | "profile_update";

export type ChangeDto = {
  id: string;
  op: ChangeOp;
  targetId: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  createdAt: string;
  revertedAt: string | null;
  messageId: string | null;
};

export type ApplyOutcome = {
  applied: ChangeDto[];
  rejected: { change: TrainerChangeType; reason: string }[];
};

export class ChangeError extends Error {
  constructor(
    public readonly code: "not_found" | "already_reverted" | "target_conflict",
    message: string
  ) {
    super(message);
    this.name = "ChangeError";
  }
}

const PROFILE_LABELS: Record<ProfileField, string> = {
  name: "Nombre",
  tone: "Tono",
  instructions: "Instrucciones",
  escalationRules: "Reglas de escalado",
  greeting: "Saludo",
};

/** Snapshot de una entrada del KB para `before`/`after` (sin org ni fechas). */
export type KbSnapshot = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
  source: "manual" | "lab" | "trainer";
  createdAt: string;
};

export function snapshotKb(e: KbEntry): KbSnapshot {
  return {
    id: e.id,
    kind: e.kind,
    question: e.question,
    answer: e.answer,
    content: e.content,
    source: e.source,
    createdAt: new Date(e.createdAt).toISOString(),
  };
}

export type ProfileSnapshot = { field: ProfileField; value: string | null };

function short(text: string | null | undefined, max = 60): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function kbLabel(s: KbSnapshot | null | undefined): string {
  if (!s) return "";
  return s.kind === "qa" ? `P/R: ${short(s.question)}` : `bloque: ${short(s.content)}`;
}

/** Resumen legible de un cambio (puro; es lo que ve el panel). */
export function summarizeChange(
  op: ChangeOp,
  before: KbSnapshot | ProfileSnapshot | null,
  after: KbSnapshot | ProfileSnapshot | null
): string {
  switch (op) {
    case "kb_add":
      return `Nueva ${kbLabel(after as KbSnapshot)}`;
    case "kb_update":
      return `Actualizada ${kbLabel((after ?? before) as KbSnapshot)}`;
    case "kb_delete":
      return `Borrada ${kbLabel(before as KbSnapshot)}`;
    case "profile_update": {
      const b = before as ProfileSnapshot | null;
      const a = after as ProfileSnapshot | null;
      const label = PROFILE_LABELS[(a ?? b)!.field];
      const prev = (b?.value ?? "").trimEnd();
      const next = (a?.value ?? "").trimEnd();
      if (next.startsWith(prev) && next.length > prev.length) {
        const added = next.slice(prev.length).trim().replace(/^-\s*/, "");
        return `${label}: se agregó «${short(added)}»`;
      }
      if (!next) return `${label}: se vació`;
      return `${label}: ahora es «${short(next)}»`;
    }
  }
}

/** Patch tipado de un solo campo (el nombre nunca es null). */
function profilePatchFor(field: ProfileField, value: string | null): ProfilePatch {
  if (field === "name") return { name: value?.trim() || "Asistente" };
  return { [field]: value } as ProfilePatch;
}

type ChangeRow = typeof schema.agentChange.$inferSelect;

export function serializeChange(row: ChangeRow): ChangeDto {
  return {
    id: row.id,
    op: row.op,
    targetId: row.targetId,
    summary: row.summary,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt.toISOString(),
    revertedAt: row.revertedAt?.toISOString() ?? null,
    messageId: row.messageId,
  };
}

type ApplyCtx = {
  organizationId: string;
  conversationId: string | null;
  messageId: string | null;
};

async function recordChange(
  db: DbOrTx,
  ctx: ApplyCtx,
  op: ChangeOp,
  targetId: string | null,
  before: KbSnapshot | ProfileSnapshot | null,
  after: KbSnapshot | ProfileSnapshot | null
): Promise<ChangeDto> {
  const inserted = await db
    .insert(schema.agentChange)
    .values({
      id: newId("agentChange"),
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      messageId: ctx.messageId,
      source: "trainer",
      op,
      targetId,
      before,
      after,
      summary: summarizeChange(op, before, after),
    })
    .returning();
  return serializeChange(inserted[0]!);
}

/**
 * Aplica cada cambio dentro de `db` (idealmente una transacción) registrando
 * la auditoría. Un cambio inválido se descarta e informa; no aborta el resto.
 */
export async function applyTrainerChanges(
  db: DbOrTx,
  ctx: ApplyCtx,
  changes: TrainerChangeType[]
): Promise<ApplyOutcome> {
  const out: ApplyOutcome = { applied: [], rejected: [] };
  for (const change of changes) {
    try {
      out.applied.push(await applyOne(db, ctx, change));
    } catch (err) {
      const reason =
        err instanceof KbError || err instanceof ChangeError
          ? err.message
          : err instanceof Error
            ? err.message
            : "cambio inválido";
      out.rejected.push({ change, reason });
    }
  }
  return out;
}

async function applyOne(
  db: DbOrTx,
  ctx: ApplyCtx,
  change: TrainerChangeType
): Promise<ChangeDto> {
  const org = ctx.organizationId;
  switch (change.op) {
    case "kb_add": {
      const input =
        change.kind === "qa"
          ? { kind: "qa" as const, question: change.question ?? "", answer: change.answer ?? "" }
          : { kind: "block" as const, content: change.content ?? "" };
      if (input.kind === "qa" && (!input.question || !input.answer)) {
        throw new KbError("invalid", "una pregunta/respuesta necesita pregunta y respuesta");
      }
      if (input.kind === "block" && !input.content) {
        throw new KbError("invalid", "un bloque necesita contenido");
      }
      const entry = await createEntry(org, input, "trainer", db);
      return recordChange(db, ctx, "kb_add", entry.id, null, snapshotKb(entry));
    }
    case "kb_update": {
      const patch: { question?: string; answer?: string; content?: string } = {};
      if (change.question) patch.question = change.question;
      if (change.answer) patch.answer = change.answer;
      if (change.content) patch.content = change.content;
      const { before, after } = await updateEntry(org, change.id, patch, db);
      return recordChange(db, ctx, "kb_update", after.id, snapshotKb(before), snapshotKb(after));
    }
    case "kb_delete": {
      const before = await deleteEntry(org, change.id, db);
      return recordChange(db, ctx, "kb_delete", before.id, snapshotKb(before), null);
    }
    case "profile_set":
    case "profile_append": {
      const current = await getProfile(org, db);
      if (!current) throw new ChangeError("target_conflict", "no hay perfil del agente");
      const field = change.field;
      const prev = (current[field] ?? null) as string | null;
      const next =
        change.op === "profile_set"
          ? change.value
          : appendToField(prev, change.text);
      if (field === "name" && !next?.trim()) {
        throw new KbError("invalid", "el nombre no puede quedar vacío");
      }
      if ((prev ?? "") === (next ?? "")) {
        throw new KbError("invalid", "ese cambio ya estaba aplicado");
      }
      const { after } = await updateProfile(org, profilePatchFor(field, next), db);
      return recordChange(
        db,
        ctx,
        "profile_update",
        field,
        { field, value: prev },
        { field, value: (after[field] ?? null) as string | null }
      );
    }
  }
}

export async function listChanges(
  organizationId: string,
  limit = 30
): Promise<ChangeDto[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.agentChange)
    .where(scoped(schema.agentChange.organizationId, organizationId))
    .orderBy(desc(schema.agentChange.createdAt), desc(schema.agentChange.id))
    .limit(limit);
  return rows.map(serializeChange);
}

/**
 * Deshace un cambio restaurando `before` (D7). Idempotente: 409 si ya fue
 * revertido; 409 `target_conflict` si el objetivo cambió de manos (una
 * actualización sin fila, o un borrado cuyo id volvió a existir).
 */
export async function revertChange(
  organizationId: string,
  changeId: string,
  userId: string
): Promise<ChangeDto> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.agentChange)
      .where(
        scoped(
          schema.agentChange.organizationId,
          organizationId,
          eq(schema.agentChange.id, changeId)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new ChangeError("not_found", "Cambio no encontrado");
    if (row.revertedAt) throw new ChangeError("already_reverted", "Ese cambio ya fue deshecho");

    switch (row.op) {
      case "kb_add": {
        // Si ya no existe, igual se marca deshecho (el objetivo es el mismo).
        if (row.targetId && (await getEntry(organizationId, row.targetId, tx))) {
          await deleteEntry(organizationId, row.targetId, tx);
        }
        break;
      }
      case "kb_update": {
        const before = row.before as KbSnapshot | null;
        if (!row.targetId || !before) throw new ChangeError("target_conflict", "Sin estado anterior");
        const current = await getEntry(organizationId, row.targetId, tx);
        if (!current) throw new ChangeError("target_conflict", "La entrada ya no existe");
        const patch =
          before.kind === "qa"
            ? { question: before.question ?? undefined, answer: before.answer ?? undefined }
            : { content: before.content ?? undefined };
        await updateEntry(organizationId, row.targetId, patch, tx);
        break;
      }
      case "kb_delete": {
        const before = row.before as KbSnapshot | null;
        if (!before) throw new ChangeError("target_conflict", "Sin estado anterior");
        const restored = await restoreEntry(
          organizationId,
          {
            id: before.id,
            organizationId,
            kind: before.kind,
            question: before.question,
            answer: before.answer,
            content: before.content,
            source: before.source,
            createdAt: new Date(before.createdAt),
            updatedAt: new Date(),
          },
          tx
        );
        if (!restored) throw new ChangeError("target_conflict", "La entrada ya existe de nuevo");
        break;
      }
      case "profile_update": {
        const before = row.before as ProfileSnapshot | null;
        if (!before) throw new ChangeError("target_conflict", "Sin estado anterior");
        await updateProfile(organizationId, profilePatchFor(before.field, before.value), tx);
        break;
      }
    }

    const updated = await tx
      .update(schema.agentChange)
      .set({ revertedAt: new Date(), revertedBy: userId })
      .where(eq(schema.agentChange.id, row.id))
      .returning();
    return serializeChange(updated[0]!);
  });
}

export type { AgentProfile };
