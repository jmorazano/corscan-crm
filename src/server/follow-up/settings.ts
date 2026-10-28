import { z } from "zod";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isValidTimeZone, localDateTimeKey } from "@/lib/time";
import {
  csvCell,
  DEFAULT_FOLLOW_UP_TEXTS,
  followUpReasonLabel,
  NAME_PLACEHOLDER,
} from "@/lib/follow-up";

/**
 * 042: configuración del seguimiento automático (en `agent_profile`), el
 * resumen de /agent y el registro exportable.
 */

const FOLLOW_UP_TEXT_MAX = 500;

const optionalText = z
  .string()
  .trim()
  .max(FOLLOW_UP_TEXT_MAX)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v && v.length > 0 ? v : null));

export const followUpSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isValidTimeZone, "Zona horaria inválida")
      .optional(),
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(1).max(24).optional(),
    text1: optionalText,
    text2: optionalText,
  })
  .strict();

export type FollowUpSettingsPatch = z.infer<typeof followUpSettingsSchema>;

export type FollowUpSettings = {
  enabled: boolean;
  timezone: string;
  startHour: number;
  endHour: number;
  text1: string | null;
  text2: string | null;
  defaultText1: string;
  defaultText2: string;
  namePlaceholder: string;
};

export class FollowUpSettingsError extends Error {
  constructor(
    public code: "not_found" | "invalid_hours",
    message: string
  ) {
    super(message);
  }
}

type Profile = typeof schema.agentProfile.$inferSelect;

function toSettings(p: Profile): FollowUpSettings {
  return {
    enabled: p.followUpEnabled,
    timezone: p.followUpTimezone,
    startHour: p.followUpStartHour,
    endHour: p.followUpEndHour,
    text1: p.followUpText1,
    text2: p.followUpText2,
    defaultText1: DEFAULT_FOLLOW_UP_TEXTS[1],
    defaultText2: DEFAULT_FOLLOW_UP_TEXTS[2],
    namePlaceholder: NAME_PLACEHOLDER,
  };
}

async function loadProfile(organizationId: string): Promise<Profile | null> {
  const rows = await getDb()
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getFollowUpSettings(organizationId: string): Promise<FollowUpSettings | null> {
  const p = await loadProfile(organizationId);
  return p ? toSettings(p) : null;
}

export async function updateFollowUpSettings(
  organizationId: string,
  patch: FollowUpSettingsPatch
): Promise<FollowUpSettings> {
  const current = await loadProfile(organizationId);
  if (!current) throw new FollowUpSettingsError("not_found", "Perfil del agente no encontrado");
  const startHour = patch.startHour ?? current.followUpStartHour;
  const endHour = patch.endHour ?? current.followUpEndHour;
  if (startHour >= endHour) {
    throw new FollowUpSettingsError("invalid_hours", "La hora de inicio tiene que ser anterior a la de fin");
  }
  const updated = await getDb()
    .update(schema.agentProfile)
    .set({
      ...(patch.enabled !== undefined ? { followUpEnabled: patch.enabled } : {}),
      ...(patch.timezone !== undefined ? { followUpTimezone: patch.timezone } : {}),
      followUpStartHour: startHour,
      followUpEndHour: endHour,
      ...(patch.text1 !== undefined ? { followUpText1: patch.text1 } : {}),
      ...(patch.text2 !== undefined ? { followUpText2: patch.text2 } : {}),
      updatedAt: new Date(),
    })
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .returning();
  return toSettings(updated[0]!);
}

export type FollowUpSummary = {
  days: number;
  sent: number;
  replied: number;
  failed: number;
  /** Respuestas del agente sin marca: si crece, el agente se olvida de marcar. */
  unmarked: number;
  skipped: { reason: string; label: string; count: number }[];
};

/** Resumen de los últimos `days` días para la tarjeta de /agent. */
export async function followUpSummary(organizationId: string, days = 7, now = new Date()): Promise<FollowUpSummary> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60_000);
  const rows = await getDb()
    .select({
      status: schema.agentFollowUp.status,
      reason: schema.agentFollowUp.reason,
      count: sql<number>`count(*)::int`,
      replied: sql<number>`count(${schema.agentFollowUp.repliedAt})::int`,
    })
    .from(schema.agentFollowUp)
    .where(
      scoped(schema.agentFollowUp.organizationId, organizationId, gte(schema.agentFollowUp.createdAt, since))
    )
    .groupBy(schema.agentFollowUp.status, schema.agentFollowUp.reason);
  const summary: FollowUpSummary = { days, sent: 0, replied: 0, failed: 0, unmarked: 0, skipped: [] };
  for (const r of rows) {
    if (r.status === "sent") {
      summary.sent += r.count;
      summary.replied += r.replied;
    } else if (r.status === "failed") {
      summary.failed += r.count;
    } else if (r.status === "skipped") {
      if (r.reason === "unmarked") summary.unmarked += r.count;
      summary.skipped.push({ reason: r.reason ?? "", label: followUpReasonLabel(r.reason), count: r.count });
    }
  }
  summary.skipped.sort((a, b) => b.count - a.count);
  return summary;
}

const CSV_HEADER = [
  "fecha",
  "contacto",
  "telefono",
  "conversacion",
  "seguimiento",
  "estado",
  "motivo",
  "texto",
  "origen_del_texto",
  "etapa",
  "contesto",
  "fecha_respuesta",
];

const STATUS_LABELS: Record<string, string> = {
  sent: "enviado",
  skipped: "omitido",
  failed: "falló",
  reserved: "en curso",
};

/** El registro completo de `days` días, en CSV (hora local de la empresa). */
export async function exportFollowUpCsv(organizationId: string, days = 90, now = new Date()): Promise<string> {
  const settings = await getFollowUpSettings(organizationId);
  const tz = settings?.timezone ?? "America/Argentina/Cordoba";
  const since = new Date(now.getTime() - days * 24 * 60 * 60_000);
  const rows = await getDb()
    .select({
      createdAt: schema.agentFollowUp.createdAt,
      sentAt: schema.agentFollowUp.sentAt,
      repliedAt: schema.agentFollowUp.repliedAt,
      step: schema.agentFollowUp.step,
      status: schema.agentFollowUp.status,
      reason: schema.agentFollowUp.reason,
      text: schema.agentFollowUp.text,
      source: schema.agentFollowUp.source,
      stageKind: schema.agentFollowUp.stageKind,
      conversationId: schema.agentFollowUp.conversationId,
      name: schema.contact.name,
      phone: schema.contact.phone,
    })
    .from(schema.agentFollowUp)
    .innerJoin(
      schema.contact,
      and(
        eq(schema.agentFollowUp.contactId, schema.contact.id),
        eq(schema.contact.organizationId, schema.agentFollowUp.organizationId)
      )
    )
    .where(
      scoped(schema.agentFollowUp.organizationId, organizationId, gte(schema.agentFollowUp.createdAt, since))
    )
    .orderBy(asc(schema.agentFollowUp.createdAt));
  const local = (d: Date | null) => (d ? localDateTimeKey(tz, d).replace("T", " ") : "");
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        local(r.sentAt ?? r.createdAt),
        r.name,
        r.phone,
        r.conversationId,
        r.step,
        STATUS_LABELS[r.status] ?? r.status,
        r.status === "failed" ? r.reason : followUpReasonLabel(r.reason),
        r.text,
        r.source === "agent" ? "la IA" : r.source === "fallback" ? "texto de respaldo" : "",
        r.stageKind === "won" ? "ganado" : r.stageKind === "lost" ? "perdido" : r.stageKind ? "abierto" : "",
        r.status === "sent" ? (r.repliedAt ? "sí" : "no") : "",
        local(r.repliedAt),
      ]
        .map(csvCell)
        .join(",")
    );
  }
  // BOM: Excel abre bien los acentos.
  return `﻿${lines.join("\r\n")}\r\n`;
}
