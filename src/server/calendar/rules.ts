import { z } from "zod";
import { isValidTimeZone } from "@/lib/time";

/**
 * Reglas de turnos por empresa (data-model 005). Módulo puro y compartido
 * por la API, la UI y el cálculo de huecos.
 */

export const WEEKDAY_KEYS = ["0", "1", "2", "3", "4", "5", "6"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** Franja local "HH:MM" → "HH:MM" (fin exclusivo). */
export type TimeRange = [string, string];
export type WeeklyHours = Record<WeekdayKey, TimeRange[]>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const timeRangeSchema = z
  .tuple([z.string().regex(HHMM, "hora inválida (HH:MM)"), z.string().regex(HHMM, "hora inválida (HH:MM)")])
  .refine(([a, b]) => toMinutes(a) < toMinutes(b), {
    message: "la franja debe terminar después de empezar",
  });

const dayRangesSchema = z
  .array(timeRangeSchema)
  .max(4, "máximo 4 franjas por día")
  .refine(
    (ranges) => {
      const sorted = [...ranges].sort((x, y) => toMinutes(x[0]) - toMinutes(y[0]));
      for (let i = 1; i < sorted.length; i++) {
        if (toMinutes(sorted[i]![0]) < toMinutes(sorted[i - 1]![1])) return false;
      }
      return true;
    },
    { message: "las franjas de un mismo día no pueden solaparse" }
  );

export const weeklyHoursSchema = z
  .object({
    "0": dayRangesSchema.optional(),
    "1": dayRangesSchema.optional(),
    "2": dayRangesSchema.optional(),
    "3": dayRangesSchema.optional(),
    "4": dayRangesSchema.optional(),
    "5": dayRangesSchema.optional(),
    "6": dayRangesSchema.optional(),
  })
  .transform((v) => normalizeWeeklyHours(v));

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  "0": [],
  "1": [["09:00", "18:00"]],
  "2": [["09:00", "18:00"]],
  "3": [["09:00", "18:00"]],
  "4": [["09:00", "18:00"]],
  "5": [["09:00", "18:00"]],
  "6": [],
};

export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

/** Completa los días ausentes con [] y ordena las franjas. */
export function normalizeWeeklyHours(
  input: Partial<Record<WeekdayKey, TimeRange[] | undefined>> | unknown
): WeeklyHours {
  const src = (input && typeof input === "object" ? input : {}) as Partial<
    Record<WeekdayKey, TimeRange[] | undefined>
  >;
  const out = {} as WeeklyHours;
  for (const k of WEEKDAY_KEYS) {
    const ranges = Array.isArray(src[k]) ? src[k]! : [];
    out[k] = [...ranges].sort((x, y) => toMinutes(x[0]) - toMinutes(y[0]));
  }
  return out;
}

const ruleFields = {
  timezone: z
    .string()
    .trim()
    .min(1)
    .refine(isValidTimeZone, { message: "zona horaria inválida" }),
  agentBookingEnabled: z.boolean(),
  slotMinutes: z.number().int().min(5).max(480),
  bufferMinutes: z.number().int().min(0).max(240),
  minLeadHours: z.number().int().min(0).max(168),
  horizonDays: z.number().int().min(1).max(90),
  bookingInstructions: z.string().trim().max(2000).nullable(),
};

export const calendarRulesSchema = z.object({
  ...ruleFields,
  weeklyHours: weeklyHoursSchema,
});

export type CalendarRules = z.infer<typeof calendarRulesSchema>;

/** PUT parcial: todos opcionales (contrato integrations-api.md). */
export const calendarRulesPatchSchema = z.object({
  timezone: ruleFields.timezone.optional(),
  agentBookingEnabled: ruleFields.agentBookingEnabled.optional(),
  slotMinutes: ruleFields.slotMinutes.optional(),
  bufferMinutes: ruleFields.bufferMinutes.optional(),
  minLeadHours: ruleFields.minLeadHours.optional(),
  horizonDays: ruleFields.horizonDays.optional(),
  bookingInstructions: ruleFields.bookingInstructions.optional(),
  weeklyHours: weeklyHoursSchema.optional(),
  calendarId: z.string().trim().min(1).max(300).optional(),
});

export const DEFAULT_RULES: CalendarRules = {
  timezone: DEFAULT_TIMEZONE,
  agentBookingEnabled: true,
  slotMinutes: 30,
  bufferMinutes: 0,
  minLeadHours: 2,
  horizonDays: 14,
  weeklyHours: DEFAULT_WEEKLY_HOURS,
  bookingInstructions: null,
};
