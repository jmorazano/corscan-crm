import { and, desc, eq, gte, inArray, isNotNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { metricsWindow, type MetricsRange } from "@/lib/metrics";
import {
  comparePeople,
  needsReview,
  responderKey,
  summarizeTeamAttention,
  type MemberAttentionRow,
  type MyAttention,
  type ResponderStats,
  type TeamAttention,
  type WaitItem,
} from "@/lib/team-attention";
import { isSuperAdminEmail } from "@/server/auth/super-admin";
import { getAttentionSettings } from "@/server/attention/settings";
import { reconcileWait, type WaitRow } from "@/server/attention/waits";

/**
 * 048: la sección «Equipo» de Métricas y «Mi atención». Mismo corte que 024
 * (`metricsWindow`: zona del navegador; una espera es del período en el que
 * EMPEZÓ). Todo con `scoped()`; las cifras de una empresa nunca se mezclan
 * con otra. Lo que cuenta como mensaje de una persona: saliente con autor,
 * no fallido, de una conversación real (no Laboratorio ni Entrenador).
 */

const WAITS_LIMIT = 20_000;
const WAITING_NOW_LIMIT = 50;
const PROBLEMS_LIMIT = 100;

const w = schema.attentionWait;
const m = schema.message;

type PeriodWait = WaitRow & { contactName: string; kind: string };

function toItem(row: PeriodWait): WaitItem {
  return {
    waitId: row.id,
    conversationId: row.conversationId,
    contactName: row.contactName,
    channel: row.kind === "instagram" ? "instagram" : "whatsapp",
    startedAt: row.startedAt.toISOString(),
    reason: row.startReason,
    status: row.status,
    responseMs: row.responseMs,
    responderName: row.responderName,
  };
}

async function periodWaits(
  organizationId: string,
  from: Date,
  to: Date,
  extra?: SQL
): Promise<PeriodWait[]> {
  const rows = await getDb()
    .select({ wait: w, contactName: schema.contact.name, kind: schema.conversation.kind })
    .from(w)
    .innerJoin(schema.conversation, eq(schema.conversation.id, w.conversationId))
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(scoped(w.organizationId, organizationId, gte(w.startedAt, from), lt(w.startedAt, to), extra))
    .orderBy(desc(w.startedAt))
    .limit(WAITS_LIMIT + 1);
  return rows.map((r) => ({ ...r.wait, contactName: r.contactName, kind: r.kind }));
}

/** Concilia las abiertas antes de mostrarlas: el barrido puede ir un minuto atrás. */
async function reconcileOpen(rows: PeriodWait[], now: Date): Promise<PeriodWait[]> {
  return Promise.all(
    rows.map(async (row) => {
      if (row.status !== "open") return row;
      const current = await reconcileWait(row, now);
      return { ...row, ...current };
    })
  );
}

type MessageAgg = { key: string; userId: string | null; name: string | null; messages: number; conversations: number };

/** Mensajes y conversaciones por persona en la ventana (clave: id o nombre copiado). */
async function messagesByPerson(
  organizationId: string,
  from: Date,
  to: Date,
  onlyUserId?: string
): Promise<MessageAgg[]> {
  const rows = await getDb()
    .select({
      userId: m.sentByUserId,
      name: sql<string | null>`max(${m.sentByName})`,
      messages: sql<number>`count(*)::int`,
      conversations: sql<number>`count(distinct ${m.conversationId})::int`,
    })
    .from(m)
    .innerJoin(schema.conversation, eq(schema.conversation.id, m.conversationId))
    .where(
      scoped(
        m.organizationId,
        organizationId,
        eq(m.direction, "out"),
        eq(m.aiGenerated, false),
        ne(m.status, "failed"),
        eq(schema.conversation.isTest, false),
        onlyUserId
          ? eq(m.sentByUserId, onlyUserId)
          : or(isNotNull(m.sentByUserId), isNotNull(m.sentByName)),
        gte(m.createdAt, from),
        lt(m.createdAt, to)
      )
    )
    // Sin cuenta (eliminada) se agrupa por el nombre copiado.
    .groupBy(m.sentByUserId, sql`case when ${m.sentByUserId} is null then ${m.sentByName} end`);
  return rows.flatMap((r) => {
    const key = responderKey(r.userId, r.name);
    return key ? [{ key, userId: r.userId, name: r.name, messages: r.messages, conversations: r.conversations }] : [];
  });
}

/** Último mensaje de cada persona (que salió), de siempre — no solo del período. */
async function lastMessageAt(organizationId: string, userIds: string[]): Promise<Map<string, Date>> {
  if (userIds.length === 0) return new Map();
  const rows = await getDb()
    // `mapWith` usa el parser de la columna: los timestamp de la BD son UTC
    // sin zona y un `max()` crudo llegaría como texto ambiguo.
    .select({ userId: m.sentByUserId, at: sql<Date | null>`max(${m.createdAt})`.mapWith(m.createdAt) })
    .from(m)
    .where(
      scoped(
        m.organizationId,
        organizationId,
        eq(m.direction, "out"),
        eq(m.aiGenerated, false),
        ne(m.status, "failed"),
        inArray(m.sentByUserId, userIds)
      )
    )
    .groupBy(m.sentByUserId);
  const map = new Map<string, Date>();
  for (const r of rows) if (r.userId && r.at) map.set(r.userId, r.at);
  return map;
}

async function members(organizationId: string, onlyUserId?: string) {
  return getDb()
    .select({
      userId: schema.member.userId,
      role: schema.member.role,
      lastSeenAt: schema.member.lastSeenAt,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(
      scoped(
        schema.member.organizationId,
        organizationId,
        onlyUserId ? eq(schema.member.userId, onlyUserId) : undefined
      )
    );
}

async function pushByUser(
  organizationId: string,
  onlyUserId?: string
): Promise<Map<string, MemberAttentionRow["push"]>> {
  const rows = await getDb()
    .select({ userId: schema.pushSubscription.userId, mode: schema.pushSubscription.mode })
    .from(schema.pushSubscription)
    .where(
      scoped(
        schema.pushSubscription.organizationId,
        organizationId,
        onlyUserId ? eq(schema.pushSubscription.userId, onlyUserId) : undefined
      )
    );
  const map = new Map<string, MemberAttentionRow["push"]>();
  for (const r of rows) {
    const entry = map.get(r.userId) ?? { devices: 0, modes: [] };
    entry.devices += 1;
    if (!entry.modes.includes(r.mode)) entry.modes.push(r.mode);
    map.set(r.userId, entry);
  }
  return map;
}

async function userEmails(ids: string[]): Promise<Map<string, { name: string; email: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
    .from(schema.user)
    .where(inArray(schema.user.id, ids));
  return new Map(rows.map((r) => [r.id, { name: r.name, email: r.email }]));
}

function periodOf(range: MetricsRange, timeZone: string, now: Date) {
  const win = metricsWindow(range, timeZone, now);
  const to = new Date(Math.min(win.end.getTime(), now.getTime() + 1));
  return { from: win.start, to };
}

function emptyRow(
  userId: string | null,
  name: string,
  role: MemberAttentionRow["role"]
): MemberAttentionRow {
  return {
    userId,
    name,
    role,
    waitsAnswered: 0,
    waitsLate: 0,
    medianResponseMs: null,
    conversations: 0,
    messages: 0,
    lastMessageAt: null,
    lastSeenAt: null,
    push: { devices: 0, modes: [] },
  };
}

/**
 * Las filas por persona: miembros de la empresa + quien respondió o envió en
 * el período sin ser miembro (se fue, o la cuenta se eliminó). Las cuentas
 * de plataforma que no son miembros van aparte (no son del equipo).
 */
async function buildPeople(input: {
  organizationId: string;
  from: Date;
  to: Date;
  byResponder: Map<string, ResponderStats>;
  onlyUserId?: string;
}): Promise<{ people: MemberAttentionRow[]; platformIds: Set<string> }> {
  const { organizationId, from, to, byResponder, onlyUserId } = input;
  const [team, agg, push] = await Promise.all([
    members(organizationId, onlyUserId),
    messagesByPerson(organizationId, from, to, onlyUserId),
    pushByUser(organizationId, onlyUserId),
  ]);

  const rows = new Map<string, MemberAttentionRow>();
  for (const member of team) {
    const row = emptyRow(member.userId, member.name, member.role === "owner" ? "owner" : "member");
    row.lastSeenAt = member.lastSeenAt?.toISOString() ?? null;
    row.push = push.get(member.userId) ?? row.push;
    rows.set(member.userId, row);
  }

  // Quien tuvo actividad sin ser miembro: ¿se fue o es de la plataforma?
  const outsiders = [
    ...new Set(
      [...agg.map((a) => a.userId), ...[...byResponder.keys()].filter((k) => !k.startsWith("name:"))].filter(
        (id): id is string => Boolean(id) && !rows.has(id as string)
      )
    ),
  ];
  const outsiderInfo = await userEmails(outsiders);
  const platformIds = new Set<string>();
  for (const id of outsiders) {
    const info = outsiderInfo.get(id);
    if (info && isSuperAdminEmail(info.email)) {
      platformIds.add(id);
      continue;
    }
    rows.set(id, emptyRow(id, info?.name ?? "Ex miembro", null));
  }

  for (const a of agg) {
    if (a.userId && platformIds.has(a.userId)) continue;
    const row = rows.get(a.key) ?? emptyRow(a.userId, a.name ?? "Ex miembro", null);
    row.messages = a.messages;
    row.conversations = a.conversations;
    rows.set(a.key, row);
  }
  for (const [key, stats] of byResponder) {
    if (platformIds.has(key)) continue;
    const row = rows.get(key) ?? emptyRow(null, stats.name ?? "Ex miembro", null);
    row.waitsAnswered = stats.answered;
    row.waitsLate = stats.late;
    row.medianResponseMs = stats.medianResponseMs;
    rows.set(key, row);
  }

  const ids = [...rows.values()].map((r) => r.userId).filter((id): id is string => Boolean(id));
  const last = await lastMessageAt(organizationId, ids);
  for (const row of rows.values()) {
    if (row.userId) row.lastMessageAt = last.get(row.userId)?.toISOString() ?? null;
  }
  return { people: [...rows.values()].sort(comparePeople), platformIds };
}

export async function getTeamAttention(
  organizationId: string,
  range: MetricsRange,
  timeZone: string,
  now: Date = new Date()
): Promise<TeamAttention> {
  const { from, to } = periodOf(range, timeZone, now);
  const settings = await getAttentionSettings(organizationId);
  const lateMinutes = settings.alertMinutes;

  const fetched = await periodWaits(organizationId, from, to);
  const truncated = fetched.length > WAITS_LIMIT;
  const inPeriod = await reconcileOpen(fetched.slice(0, WAITS_LIMIT), now);

  // Las abiertas de AHORA pueden haber empezado antes del período.
  const openNow = await reconcileOpen(
    (
      await periodWaits(organizationId, new Date(0), new Date(now.getTime() + 1), eq(w.status, "open"))
    ).slice(0, WAITING_NOW_LIMIT),
    now
  );
  const waitingNow = openNow
    .filter((r) => r.status === "open")
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    .map(toItem);

  // Primero el resumen sin plataforma para saber quién es quién…
  const preliminary = summarizeTeamAttention(inPeriod, lateMinutes);
  const { people, platformIds } = await buildPeople({
    organizationId,
    from,
    to,
    byResponder: preliminary.byUser,
  });
  // …y el definitivo, con la plataforma aparte.
  const { summary } = summarizeTeamAttention(inPeriod, lateMinutes, platformIds);

  const problems = inPeriod
    .filter((r) => needsReview(r, lateMinutes))
    .slice(0, PROBLEMS_LIMIT)
    .map(toItem);

  return {
    range,
    timeZone,
    from: from.toISOString(),
    to: to.toISOString(),
    lateMinutes,
    summary,
    waitingNow,
    problems,
    people,
    truncated,
  };
}

/** «Mi atención»: SOLO la fila de quien pregunta. Nada de otras personas. */
export async function getMyAttention(
  organizationId: string,
  userId: string,
  range: MetricsRange,
  timeZone: string,
  now: Date = new Date()
): Promise<MyAttention> {
  const { from, to } = periodOf(range, timeZone, now);
  const settings = await getAttentionSettings(organizationId);
  const lateMinutes = settings.alertMinutes;
  const mine = await reconcileOpen(
    await periodWaits(organizationId, from, to, and(eq(w.responderUserId, userId), eq(w.status, "answered"))),
    now
  );
  const { byUser } = summarizeTeamAttention(mine, lateMinutes);
  const { people } = await buildPeople({ organizationId, from, to, byResponder: byUser, onlyUserId: userId });
  const me = people.find((p) => p.userId === userId) ?? emptyRow(userId, "", null);
  return {
    range,
    timeZone,
    from: from.toISOString(),
    to: to.toISOString(),
    lateMinutes,
    me,
  };
}
