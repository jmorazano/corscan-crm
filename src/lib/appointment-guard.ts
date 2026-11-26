/**
 * GUARDA DE TURNOS SIN AGENDADO (005 · fix nov-2026).
 *
 * POR QUÉ EXISTE
 * --------------
 * Con Google Calendar conectado y «El agente puede agendar turnos por su
 * cuenta» APAGADO, el servidor ya rechaza `book_appointment` (deriva al
 * equipo sin crear el evento). Pero nada impedía que el modelo contestara con
 * un `reply` diciendo «¡Listo! Te agendé el turno para el martes a las 10»:
 * el cliente se queda tranquilo, no hay evento en el calendario y nadie del
 * equipo se entera. Es la misma lógica de la guarda de promesas de 016, para
 * turnos: corre sobre el TEXTO SALIENTE, no depende de que el modelo obedezca.
 *
 * QUÉ DETECTA
 * -----------
 * - Compromiso en primera persona: «te agendo», «te agendé», «agendé tu
 *   turno», «te reservo el horario», «te confirmo la cita», «te anoto para el
 *   martes», «te lo voy a agendar».
 * - Estado: «tu turno quedó confirmado», «queda agendado», «turno
 *   confirmado», «listo, agendado». Si el cliente YA tiene un turno futuro
 *   registrado, esta familia no se vigila (afirmarlo es la verdad).
 *
 * QUÉ NO DEBE DETECTAR
 * --------------------
 * Ofrecer y preguntar es correcto («¿querés que te agende el martes?», «si te
 * parece te agendo»): cuando el cliente diga que sí, el modelo llama a la
 * herramienta (que deriva) o afirma el turno (y ahí salta esta guarda). Ni lo
 * que hace otro («un compañero te confirma el turno»), ni lo negado («no te
 * puedo agendar»), ni lo condicional («queda agendado cuando el equipo lo
 * confirme»), ni un horario ocupado por otro.
 *
 * Módulo puro: entra texto, sale la detección. Reemplazar y derivar es
 * trabajo del pipeline.
 */
import { normalizar } from "@/lib/promise-guard";

export interface AppointmentClaim {
  claims: boolean;
  match: string | null;
}

/** Lo que se agenda. Sin «horario»: «te confirmo el horario de atención» informa. */
const OBJ = "(?:turnos?|citas?|llamadas?|videollamadas?|reunion(?:es)?|consultas?|visitas?|sesion(?:es)?|entrevistas?|demos?)";
/** Para retener sí vale «horario»: «te reservo ese horario» es tomarlo. */
const OBJ_HORARIO = `(?:${OBJ}|horarios?|hora)`;
const FIN_1P = "(?:o|e|amos|emos)";
const DET = "(?:el|la|tu|su|ese|esa|este|esta|una?)";
const DIA =
  "(?:el|la|las|manana|hoy|pasado|lunes|martes|miercoles|jueves|viernes|sabado|domingo)";
const PART = "(?:agendad|confirmad|reservad|registrad|anotad|programad|fijad)[oa]s?";

type Familia = "compromiso" | "estado";

const REGLAS: { id: string; familia: Familia; patron: RegExp }[] = [
  // «te agendo», «ya te lo agendé», «la agendamos»
  {
    id: "te-agendo",
    familia: "compromiso",
    patron: new RegExp(
      `\\b(?:ya\\s+)?(?:te\\s+(?:(?:la|lo|las|los)\\s+)?|(?:la|lo|las|los)\\s+)agend${FIN_1P}\\b`,
      "g"
    ),
  },
  // «agendé tu turno», «agendamos la llamada»
  {
    id: "agendo-objeto",
    familia: "compromiso",
    patron: new RegExp(`\\b(?:ya\\s+)?agend${FIN_1P}\\s+${DET}\\s+${OBJ_HORARIO}\\b`, "g"),
  },
  // «te reservo el turno», «te guardo ese horario»
  {
    id: "te-retengo-objeto",
    familia: "compromiso",
    patron: new RegExp(
      `\\b(?:ya\\s+)?te\\s+(?:reserv|separ|guard|bloque|program|fij)${FIN_1P}\\s+${DET}\\s+${OBJ_HORARIO}\\b`,
      "g"
    ),
  },
  // «te confirmo el turno», «te anoté la cita»
  {
    id: "te-confirmo-objeto",
    familia: "compromiso",
    patron: new RegExp(`\\b(?:ya\\s+)?te\\s+(?:confirm|anot)${FIN_1P}\\s+${DET}\\s+${OBJ}\\b`, "g"),
  },
  // «te anoto para el martes a las 10»
  {
    id: "te-anoto-dia",
    familia: "compromiso",
    patron: new RegExp(`\\b(?:ya\\s+)?te\\s+anot${FIN_1P}\\s+para\\s+${DIA}\\b`, "g"),
  },
  // «te lo voy a agendar», «vamos a agendarte», «voy a reservarte el turno»
  {
    id: "futuro",
    familia: "compromiso",
    patron: new RegExp(
      `\\b(?:te\\s+)?(?:(?:la|lo)\\s+)?(?:voy|vamos|paso)\\s+a\\s+(?:` +
        `agendar(?:te|la|lo|tela|telo)?|` +
        `(?:reservar|separar|guardar)(?:te|tela|telo)?\\s+${DET}\\s+${OBJ_HORARIO})\\b`,
      "g"
    ),
  },
  // «queda agendado», «quedaste agendada», «ya está agendado»
  {
    id: "estado-agendado",
    familia: "estado",
    patron: new RegExp(
      `\\b(?:ya\\s+)?(?:te\\s+)?(?:qued(?:a|o|an|aste|as|amos)|est(?:a|as|an)|dej(?:o|e|amos))\\s+(?:ya\\s+)?agendad[oa]s?\\b`,
      "g"
    ),
  },
  // «tu turno quedó confirmado», «el turno ya quedó reservado»
  {
    id: "estado-objeto-antes",
    familia: "estado",
    patron: new RegExp(
      `\\b(?:(?:tu|su)\\s+${OBJ}\\s+(?:\\w+\\s+){0,4}?(?:ya\\s+)?(?:qued(?:a|o)|esta)|` +
        `el\\s+${OBJ}\\s+(?:\\w+\\s+){0,4}?(?:ya\\s+)?quedo)\\s+(?:ya\\s+)?${PART}`,
      "g"
    ),
  },
  // «quedó confirmado tu turno», «ya está reservada la cita»
  {
    id: "estado-objeto-despues",
    familia: "estado",
    patron: new RegExp(
      `\\b(?:qued(?:a|o)|esta)\\s+(?:ya\\s+)?${PART}\\s+(?:el|la|tu|su)\\s+${OBJ}\\b`,
      "g"
    ),
  },
  // «¡Turno confirmado!», «cita agendada»
  {
    id: "objeto-participio",
    familia: "estado",
    patron: new RegExp(`\\b${OBJ}\\s+(?:confirmad|agendad|reservad|anotad)[oa]s?\\b`, "g"),
  },
  // «listo, agendado», «perfecto, ya está reservado»
  {
    id: "marcador",
    familia: "estado",
    patron: new RegExp(
      `\\b(?:listo|lista|hecho|dale|perfecto|genial|joya|buenisimo|ok|okey)\\s+(?:ya\\s+)?(?:esta\\s+|quedo\\s+)?(?:agendad|reservad)[oa]s?\\b`,
      "g"
    ),
  },
];

/** «no te puedo agendar», «nunca te agendo»: negación pegada (≤2 palabras). */
const NEGACION = /\b(?:no|nunca|jamas|tampoco)\s+(?:\w+\s+){0,2}$/;
/** «¿querés que te agende?»: subjuntivo de ofrecimiento. */
const SUBJUNTIVO = /\b(?:que|quiere\w*|quieras)\s+$/;
/** «queda agendado cuando el equipo lo confirme». */
const CONDICIONAL_DESPUES =
  /^\s*(?:\w+\s+){0,3}?(?:cuando|una\s+vez|recien|apenas|luego\s+de|despues\s+de|si\s+(?:el|la|un)\s+)/;
/** «cuando el equipo lo confirme, queda agendado» / «si te parece, te agendo». */
const CONDICIONAL_ANTES =
  /\b(?:cuando|una\s+vez\s+que|apenas|en\s+cuanto|si\s+(?:quer|te\s+parece|prefer|te\s+viene|te\s+sirve|te\s+queda|me\s+confirm|confirm))/;
/** «ese horario ya está reservado por otro paciente». */
const OTRO = /^\s*(?:\w+\s+){0,2}?(?:por|para)\s+(?:otr[oa]s?|alguien)/;
/** Fin de oración en el texto ORIGINAL (la normalización borra la puntuación). */
const CORTE = /[.;!?\n]/;

/** La oración que contiene [inicio, fin) es una pregunta. */
function esPregunta(original: string, inicio: number, fin: number): boolean {
  const resto = original.slice(fin);
  const corte = resto.search(CORTE);
  if (corte >= 0 && resto.charAt(corte) === "?") return true;
  const antes = original.slice(0, inicio);
  const ultimoCorte = Math.max(
    antes.lastIndexOf("."),
    antes.lastIndexOf("!"),
    antes.lastIndexOf("?"),
    antes.lastIndexOf("\n"),
    antes.lastIndexOf(";")
  );
  return antes.slice(ultimoCorte + 1).includes("¿");
}

/** Lo que está antes del match DENTRO de la misma oración (normalizado). */
function mismaOracionAntes(plano: string, original: string, inicio: number): string {
  const antes = original.slice(0, inicio);
  let desde = 0;
  for (let i = antes.length - 1; i >= 0; i -= 1) {
    if (CORTE.test(antes.charAt(i))) {
      desde = i + 1;
      break;
    }
  }
  return plano.slice(desde, inicio);
}

/**
 * ¿El texto afirma o promete un turno que el agente no puede agendar?
 * `hasOwnAppointment`: el cliente ya tiene un turno futuro registrado; las
 * afirmaciones de estado pueden ser verdad y no se vigilan.
 */
export function detectAppointmentClaim(
  text: string | null | undefined,
  options?: { hasOwnAppointment?: boolean }
): AppointmentClaim {
  const original = text ?? "";
  if (!original.trim()) return { claims: false, match: null };
  const plano = normalizar(original);
  let mejor: { indice: number; largo: number } | null = null;

  for (const regla of REGLAS) {
    if (options?.hasOwnAppointment && regla.familia === "estado") continue;
    regla.patron.lastIndex = 0;
    for (let m = regla.patron.exec(plano); m !== null; m = regla.patron.exec(plano)) {
      const bruto = m[0] ?? "";
      if (!bruto) {
        regla.patron.lastIndex += 1;
        continue;
      }
      const inicio = m.index;
      const fin = inicio + bruto.length;
      const antes = mismaOracionAntes(plano, original, inicio);
      const despues = plano.slice(fin, fin + 60);
      const perdonado =
        NEGACION.test(antes.slice(-30)) ||
        SUBJUNTIVO.test(antes.slice(-20)) ||
        CONDICIONAL_ANTES.test(antes) ||
        esPregunta(original, inicio, fin) ||
        (regla.familia === "estado" && (CONDICIONAL_DESPUES.test(despues) || OTRO.test(despues)));
      if (perdonado) continue;
      if (!mejor || inicio < mejor.indice) mejor = { indice: inicio, largo: bruto.length };
      break;
    }
  }

  if (!mejor) return { claims: false, match: null };
  return { claims: true, match: original.slice(mejor.indice, mejor.indice + mejor.largo) };
}

/**
 * La frase que sale en lugar de la afirmación (la misma del rechazo de
 * `book_appointment` con el agendado apagado). Escrita para no disparar la
 * propia guarda: hay un test que lo verifica.
 */
export const TEAM_CONFIRMS_APPOINTMENT =
  "Perfecto, un compañero del equipo te confirma ese turno enseguida.";
