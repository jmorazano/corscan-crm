/**
 * CONFORMIDAD EXPLÍCITA DEL INTERESADO (032).
 *
 * Una herramienta que ESCRIBE en el sistema del cliente (registrar una
 * reserva) no sale porque el modelo lo decida: sale si la ÚLTIMA palabra del
 * interesado —lo que escribió después de la última respuesta del agente— es
 * un «sí». El servidor de Altos pide lo mismo (`confirmed: true` «afirma que
 * esa persona vio ese resumen y aceptó»), pero eso lo manda el MODELO; esta
 * barrera la pone el CRM sobre el texto real del cliente.
 *
 * Conservadora a propósito: el modo de falla caro es registrar una reserva
 * que nadie pidió. El barato es preguntar una vez más «¿confirmás?». Por eso:
 *
 * - cualquier negación, duda o postergación anula («sí, pero esperá»,
 *   «todavía no», «lo consulto»);
 * - la afirmación tiene que estar AL PRINCIPIO de alguno de los mensajes;
 * - las afirmaciones cortas y ambiguas («va», «bueno», «claro») solo cuentan
 *   en un mensaje corto: «va a venir mi primo» no es un sí;
 * - «si» sin tilde seguido de «me/te/lo/hay/podés…» es un condicional («si
 *   me pasás el CBU…»), no un sí;
 * - «no hay problema» / «no te preocupes» cuentan como afirmación, no como
 *   negación.
 *
 * Módulo puro: sin imports, sin I/O.
 */

const SIN_TILDE: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n",
};

function plano(text: string): string {
  return text
    .toLowerCase()
    .replace(/[áéíóúüñ]/g, (c) => SIN_TILDE[c] ?? c)
    .replace(/[^\p{L}\p{N}\s👍✅🙌👌]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Frases con «no» que AFIRMAN. Se neutralizan antes de buscar negaciones. */
const NO_AFIRMATIVO = /\bno (?:hay (?:ningun )?problema|te preocupes|problem|pasa nada|drama)\b/g;

const NEGACION =
  /\b(?:no|nop|nope|nah|todavia|aun no|espera|espere|esperame|pera|frena|deja|dejalo|mejor no|cancel\w*|despues|mas tarde|otro dia|lo pienso|pensarlo|consulto|consultar\w*|dudo|duda|tal vez|quizas|capaz|cambiar|cambio|modificar|corregir|corrijo|error|mal|equivoc\w*|ni)\b/;

/** Afirmaciones inequívocas: valen al principio de cualquier mensaje. */
const FUERTE =
  /^(?:si+|sip|sisi|dale|ok|oka|okey|okay|confirmo|confirmado|confirmamos|confirmala|confirmalo|de acuerdo|acepto|aceptamos|perfecto|perfecta|listo|lista|adelante|avanza|avanzamos|avanzala|hacela|hacelo|correcto|exacto|esta bien|todo bien|todo ok|me parece bien|reservala|reservalo|hagamosla|hagamoslo|de una|👍|✅|🙌|👌)(?:\s|$)/;

/** Afirmaciones que solo cuentan en un mensaje corto (≤ 4 palabras). */
const DEBIL = /^(?:va|vamos|bueno|claro|seguro|genial|buenisimo|joya|obvio|por supuesto|excelente)(?:\s|$)/;

/** «si me pasás…», «si hay lugar…»: condicional, no afirmación. */
const SI_CONDICIONAL =
  /^si (?:me|te|le|nos|lo|la|los|las|se|es|esta|hay|puedo|podes|podemos|queres|quiero|tengo|tenes|ya|el|vos|fuera|necesit\w*|pag\w*|reserv\w*|confirm\w*|llego|llegamos|vamos)\b/;

function afirma(original: string): boolean {
  const conTilde = /^\s*sí/i.test(original);
  const t = plano(original).replace(NO_AFIRMATIVO, "si");
  if (!t) return false;
  if (!conTilde && SI_CONDICIONAL.test(t)) return false;
  if (FUERTE.test(t)) return true;
  return DEBIL.test(t) && t.split(" ").length <= 4;
}

/**
 * ¿Los mensajes del interesado (los posteriores a la última respuesta del
 * agente, en orden) son una conformidad explícita?
 */
export function isExplicitConsent(messages: readonly string[]): boolean {
  const textos = messages.filter((m) => typeof m === "string" && m.trim().length > 0);
  if (textos.length === 0) return false;
  const todo = textos.map(plano).join(" ").replace(NO_AFIRMATIVO, " ");
  if (NEGACION.test(todo)) return false;
  return textos.some(afirma);
}
