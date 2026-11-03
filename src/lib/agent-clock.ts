/**
 * La hora del negocio para el agente (pedido de Altos de la Ciudad,
 * 3-nov-2026). El modelo no tiene reloj: sin esta línea adivinaba la hora
 * (casi siempre de día) y aplicaba la regla de horario equivocada — el
 * ingreso «de 17 a 22» a las 22:55, o «te responden en un momento» a las
 * 23:24 con el equipo atendiendo recién a las 9.
 *
 * PURO: se calcula en cada turno con el instante en que se responde (después
 * de la espera del agente), en la zona horaria de la empresa.
 */

import { isValidTimeZone, pad, toLocalParts, tzOffsetMinutes, WEEKDAY_ES_LONG } from "@/lib/time";

export const DEFAULT_AGENT_TIMEZONE = "America/Argentina/Cordoba";

/** Encabezado de la sección (lo buscan los tests y el ai-mock). */
export const CLOCK_MARKER = "FECHA Y HORA";

/** La zona de la empresa si es válida; si no, la de Córdoba. */
export function agentTimeZone(timeZone: string | null | undefined): string {
  const tz = timeZone?.trim();
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_AGENT_TIMEZONE;
}

/** Las ciudades de las zonas IANA vienen sin tildes. */
const CITY_NAMES: Record<string, string> = {
  Cordoba: "Córdoba",
  Tucuman: "Tucumán",
  Rio_Gallegos: "Río Gallegos",
  Asuncion: "Asunción",
  Bogota: "Bogotá",
  Mexico_City: "Ciudad de México",
  Sao_Paulo: "São Paulo",
};

/** "hora de Córdoba" a partir de "America/Argentina/Cordoba". */
export function zoneLabel(timeZone: string): string {
  const city = timeZone.split("/").pop() ?? timeZone;
  if (city === "UTC" || city === "GMT") return "hora UTC";
  return `hora de ${CITY_NAMES[city] ?? city.replace(/_/g, " ")}`;
}

/** "UTC−3", "UTC+5:30", "UTC". */
export function utcOffsetLabel(timeZone: string, at: Date): string {
  const minutes = tzOffsetMinutes(timeZone, at);
  if (minutes === 0) return "UTC";
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${pad(m)}` : ""}`;
}

/** «Ahora: martes 3/11/2026, 22:35 (hora de Córdoba, UTC−3).» */
export function nowLine(at: Date, timeZone: string): string {
  const tz = agentTimeZone(timeZone);
  const p = toLocalParts(tz, at);
  const weekday = WEEKDAY_ES_LONG[p.weekday]!.toLowerCase();
  return `Ahora: ${weekday} ${p.day}/${p.month}/${p.year}, ${pad(p.hour)}:${pad(p.minute)} (${zoneLabel(tz)}, ${utcOffsetLabel(tz, at)}).`;
}

/** Sección del prompt del agente que atiende a los clientes. */
export function clockSection(at: Date, timeZone: string): string {
  return [
    `${CLOCK_MARKER}: ${nowLine(at, timeZone)}`,
    "- Es la hora real del negocio en este momento. Usala para TODO lo que dependa del día o la hora: horarios de ingreso o de atención, cierres distintos de día y de noche, «hoy», «mañana», «esta noche», «el finde».",
    "- Si según tus instrucciones a esta hora el equipo no atiende, no digas que le responden «en un momento» ni «a la brevedad»: decile cuándo retoman.",
  ].join("\n");
}
