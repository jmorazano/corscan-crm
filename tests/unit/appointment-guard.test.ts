import { describe, expect, it } from "vitest";
import { detectAppointmentClaim, TEAM_CONFIRMS_APPOINTMENT } from "@/lib/appointment-guard";

/**
 * Guarda de turnos con el agendado apagado. Falso negativo: el cliente cree
 * que tiene turno y no lo tiene. Falso positivo: el agente no puede ofrecer
 * horarios ni preguntar cuál le queda mejor (y deriva de más).
 */

const AFIRMA = [
  "¡Listo! Te agendé el turno para el martes a las 10. Te esperamos.",
  "Dale, te agendo el jueves a las 15 hs.",
  "Ya te lo agendé, cualquier cosa avisame.",
  "Agendé tu turno para mañana 9:30.",
  "Agendamos la llamada para el viernes a las 11.",
  "Te reservo el turno de las 10.",
  "Te guardo ese horario hasta mañana.",
  "Te confirmo el turno para el lunes 9:00.",
  "Te anoto para el martes a las 10.",
  "Te lo voy a agendar ahora.",
  "Vamos a agendarte para el miércoles.",
  "Perfecto, tu turno quedó confirmado para el martes 10:00.",
  "Tu cita ya está agendada.",
  "El turno quedó reservado a tu nombre.",
  "Quedó confirmado tu turno, te esperamos.",
  "Queda agendado para el jueves a las 16.",
  "¡Turno confirmado! Nos vemos el martes.",
  "Listo, agendado.",
  "Perfecto, ya está reservado.",
  "Quedaste agendada para el lunes a las 9.",
  "Genial 😊 te agendé para el martes a las 10 hs",
];

const NO_AFIRMA = [
  TEAM_CONFIRMS_APPOINTMENT,
  "Tengo estos horarios disponibles: martes 10:00, martes 11:00. ¿Cuál te queda mejor?",
  "¿Querés que te agende el martes a las 10?",
  "¿Te agendo el martes a las 10?",
  "Si te parece, te agendo el martes y el equipo te lo confirma.",
  "Un compañero del equipo te confirma el turno enseguida.",
  "El equipo te va a confirmar el turno por este medio.",
  "No te puedo agendar yo, pero el equipo te confirma enseguida.",
  "No te agendo todavía: primero el equipo revisa la agenda.",
  "Queda agendado cuando el equipo lo confirme.",
  "Cuando el equipo lo confirme, queda agendado.",
  "Ese horario ya está reservado por otro paciente, te ofrezco el de las 11.",
  "El turno de las 10 ya no está disponible.",
  "Para agendar un turno, decime qué día te queda mejor.",
  "Podés agendar desde el enlace o te ayudo por acá.",
  "Te confirmo el horario de atención: lunes a viernes de 9 a 18.",
  "Te confirmo que hay lugar el martes a las 10.",
  "Perfecto, anotado tu nombre.",
  "¿Tenés algún turno agendado con nosotros?",
  "Hola, ¿en qué te puedo ayudar?",
  "",
];

describe("detectAppointmentClaim", () => {
  it.each(AFIRMA)("detecta: %s", (texto) => {
    const r = detectAppointmentClaim(texto);
    expect(r.claims).toBe(true);
    expect(r.match).toBeTruthy();
  });

  it.each(NO_AFIRMA)("deja pasar: %s", (texto) => {
    expect(detectAppointmentClaim(texto)).toEqual({ claims: false, match: null });
  });

  it("devuelve el fragmento ORIGINAL (con tildes) para el registro", () => {
    expect(detectAppointmentClaim("Dale, te agendé el martes.").match).toBe("te agendé");
  });

  it("con un turno ya registrado, afirmar el estado es la verdad; prometer uno nuevo no", () => {
    const opts = { hasOwnAppointment: true };
    expect(detectAppointmentClaim("Tu turno está confirmado para el jueves 10:00.", opts).claims).toBe(false);
    expect(detectAppointmentClaim("¡Turno confirmado! Te esperamos el jueves.", opts).claims).toBe(false);
    expect(detectAppointmentClaim("Dale, te agendo otro para el viernes.", opts).claims).toBe(true);
  });
});
