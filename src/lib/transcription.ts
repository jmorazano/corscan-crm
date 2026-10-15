/**
 * Reglas PURAS sobre la salida de una transcripción de nota de voz.
 *
 * Incidente del 12 al 14-oct-2026 («Negocio de Juan Morazano»): 4 de 9
 * notas de voz de clientes que llegaban por anuncios quedaron «No se pudo
 * transcribir el audio». El proveedor respondía 200 en ~2 s, pero Gemini
 * devolvía el sentinel de «sin contenido» aunque el audio tenía voz en
 * español clara. El prompt le ofrecía esa salida ante cualquier duda; al
 * quitarla, con temperatura 0 uno de los audios cayó en un bucle
 * («No, no, no, …» hasta el tope de tokens), y ante silencio el modelo
 * INVENTA una consulta plausible («Hola, ¿cómo estás? Te hago una
 * consulta…»), con cualquier prompt. Acá viven las defensas: reconocer el
 * sentinel, reconocer (y recortar) un bucle, no mandar silencio al modelo
 * y descartar lo que no se puede haber dicho en lo que dura el audio.
 */

/** Lo que devuelve el modelo cuando en el audio no habla nadie. */
export const TRANSCRIPTION_EMPTY_SENTINEL = "[SIN_CONTENIDO]";

/** ¿El modelo dijo que no hay voz, o solo marcó partes que no se entienden? */
export function isEmptyTranscription(text: string): boolean {
  const t = text.trim();
  if (!t || /^\[?\s*sin[_ ]contenido\s*\]?\.?$/i.test(t)) return true;
  // «[…] […]»: el modelo no entendió nada, aunque no lo haya dicho así.
  return !/[\p{L}\p{N}]/u.test(t.replace(/\[[^\]]*\]/g, ""));
}

/**
 * Velocidad de habla tope, con margen: en las notas reales medidas (oct-2026)
 * la más rápida rondaba 17 caracteres por segundo. El margen fijo cubre
 * audios de un segundo («Hola, buen día»).
 */
const MAX_CHARS_PER_SECOND = 30;
const PLAUSIBLE_SLACK_CHARS = 20;

/**
 * ¿Pudo decirse este texto en lo que dura el audio? Sin duración conocida
 * (formatos que no son OGG) no se descarta nada.
 */
export function isPlausibleTranscription(text: string, durationMs: number | null): boolean {
  if (durationMs === null) return true;
  const chars = text.replace(/\s+/g, " ").trim().length;
  return chars <= PLAUSIBLE_SLACK_CHARS + (MAX_CHARS_PER_SECOND * durationMs) / 1000;
}

/** Proporción de paquetes de silencio desde la que no vale la pena transcribir. */
const SILENT_RECORDING_RATIO = 0.9;

/**
 * ¿La grabación es silencio digital (micrófono muteado o sin permiso)? Ahí
 * el modelo inventa una consulta: no se le manda. En las notas reales los
 * silencios son pausas sueltas (a lo sumo ~17 % de los paquetes).
 */
export function isSilentRecording(stats: { packets: number; silentPackets: number }): boolean {
  return stats.packets > 0 && stats.silentPackets / stats.packets >= SILENT_RECORDING_RATIO;
}

/** Una unidad de hasta 4 palabras repetida seguida tantas veces = bucle. */
const LOOP_MIN_REPEATS = 8;
/** Al recortar un bucle quedan como mucho estas repeticiones (un «no, no, no» real). */
const KEPT_REPEATS = 3;
const MAX_UNIT_WORDS = 4;

/** Palabra comparable: sin mayúsculas, tildes ni puntuación. */
function norm(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

type Run = { unit: number; repeats: number };

/** La repetición seguida más larga (en palabras) que arranca en `i`. */
function runAt(keys: string[], i: number): Run {
  let best: Run = { unit: 1, repeats: 1 };
  for (let unit = 1; unit <= MAX_UNIT_WORDS && i + unit <= keys.length; unit++) {
    // Una unidad de solo puntuación no cuenta como palabra repetida.
    if (keys.slice(i, i + unit).every((k) => !k)) continue;
    let repeats = 1;
    while (
      i + (repeats + 1) * unit <= keys.length &&
      keys
        .slice(i + repeats * unit, i + (repeats + 1) * unit)
        .every((k, j) => k === keys[i + j])
    ) {
      repeats++;
    }
    if (repeats * unit > best.repeats * best.unit) best = { unit, repeats };
  }
  return best;
}

/** ¿La transcripción tiene un tramo repetido en bucle? */
export function isDegenerateTranscription(text: string): boolean {
  const keys = text.split(/\s+/).filter(Boolean).map(norm);
  for (let i = 0; i < keys.length; i++) {
    if (runAt(keys, i).repeats >= LOOP_MIN_REPEATS) return true;
  }
  return false;
}

/**
 * Recorta cada tramo repetido a lo sumo `KEPT_REPEATS` veces, conservando
 * las palabras originales. Lo que el cliente dijo antes y después del bucle
 * queda intacto: es mejor que tirar la nota entera.
 */
export function collapseRepetitions(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const keys = words.map(norm);
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    const run = runAt(keys, i);
    if (run.repeats > KEPT_REPEATS) {
      out.push(...words.slice(i, i + run.unit * KEPT_REPEATS));
      i += run.unit * run.repeats;
    } else {
      out.push(words[i]!);
      i++;
    }
  }
  return out.join(" ");
}
