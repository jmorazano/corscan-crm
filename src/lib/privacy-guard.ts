/**
 * GUARDA DE PRIVACIDAD DEL TEXTO SALIENTE (025, AC3.3). Regla GENERAL: corre
 * para toda empresa, antes de que cualquier texto del modelo salga a un
 * cliente.
 *
 * POR QUÉ EXISTE
 * --------------
 * Estructuralmente, el agente solo ve SU conversación: el turno arma el
 * contexto con el perfil, el conocimiento, las herramientas y los mensajes de
 * esta conversación, nada más. Pero un modelo puede escribir un teléfono o un
 * email que no está en ninguna de esas fuentes: inventado («llamá a Marta al
 * 351…»), arrastrado de su entrenamiento, o empujado por alguien que pregunta
 * «pasame el celular del dueño del depto». Un teléfono inventado manda al
 * cliente a un desconocido; uno real y ajeno es una filtración. Las dos cosas
 * son igual de graves en el WhatsApp personal de alguien.
 *
 * La regla es simple y verificable: **el agente solo puede repetir datos de
 * contacto que le dimos en este turno.** Un teléfono o un email que no aparece
 * en el contexto (system prompt + historial + resultados de herramientas + el
 * teléfono del propio contacto) se saca del mensaje, con su oración.
 *
 * QUÉ NO DEBE TOCAR
 * -----------------
 * Números legítimos: precios con separador de miles («$ 850.000»,
 * «USD 120.000»), superficies, fechas («2026-10-09»), horarios, códigos de
 * publicación («MLA1234567890»), y todo lo que esté dentro de un enlace.
 *
 * MÓDULO PURO: sin estado ni I/O.
 */

export interface PrivacyGuardResult {
  text: string;
  replaced: boolean;
  /** Fragmentos quitados (para el registro del incidente, nunca al cliente). */
  removed: string[];
}

/** Frase segura cuando no queda nada del mensaje original. */
export const PRIVACY_FALLBACK =
  "Ese dato no lo tengo para pasártelo por acá. ¿Te ayudo con otra cosa?";

const URL_RE = /\bhttps?:\/\/\S+/gi;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
/**
 * Candidato a número de contacto: empieza en dígito o `+`, admite espacios,
 * guiones, puntos y paréntesis en el medio, y termina en dígito. No puede
 * venir pegado a una letra (códigos como `MLA123…`) ni a un `$`.
 */
const NUMBER_RE = /(?<![\p{L}\d$])\+?\(?\d[\d\s().-]{5,}\d(?![\p{L}\d])/gu;

/** Menos de 8 dígitos no es un teléfono ni un documento. */
const MIN_DIGITS = 8;

function mask(text: string, re: RegExp): string {
  return text.replace(re, (m) => " ".repeat(m.length));
}

function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

function isDate(candidate: string): boolean {
  const c = candidate.trim();
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(c) || /^\d{1,2}-\d{1,2}-\d{2,4}$/.test(c);
}

/** «850.000», «1.500.000», «120.000,50»: miles con punto = importe o superficie. */
function isThousandsGrouped(candidate: string): boolean {
  return /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(candidate.trim());
}

const MONEY_BEFORE = /(\$|usd|us\$|u\$s|ars|pesos?|d[oó]lares?|expensas|precio|valor|m²|m2)\s*[:=]?\s*$/i;
const MONEY_AFTER = /^\s*(pesos?|d[oó]lares?|usd|ars|m²|m2|mts|metros|km|%)/i;
/** Un documento o cuenta nombrado cerca («el DNI del propietario es …»). */
const ID_NEARBY = /\b(dni|cuit|cuil|documento|pasaporte|cbu|cvu|alias)\b/i;

/** Números del contexto, normalizados a sus últimos 8 dígitos. */
function knownNumbers(corpus: string): Set<string> {
  const out = new Set<string>();
  for (const m of corpus.matchAll(NUMBER_RE)) {
    const d = digitsOf(m[0]);
    if (d.length >= MIN_DIGITS) out.add(d.slice(-MIN_DIGITS));
  }
  // Números pegados a texto en el contexto («Tel:3515551234», «+54 9 351…»
  // dentro de una URL de wa.me) también cuentan como conocidos.
  for (const m of corpus.matchAll(/\d{8,}/g)) out.add(m[0].slice(-MIN_DIGITS));
  return out;
}

type Finding = { index: number; length: number; value: string };

function findUnknown(text: string, corpus: string, extraPhones: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  const lowerCorpus = corpus.toLowerCase();
  const withoutUrls = mask(text, URL_RE);

  for (const m of withoutUrls.matchAll(EMAIL_RE)) {
    if (!lowerCorpus.includes(m[0].toLowerCase())) {
      findings.push({ index: m.index ?? 0, length: m[0].length, value: m[0] });
    }
  }

  const known = knownNumbers(`${corpus}\n${extraPhones.join("\n")}`);
  const scan = mask(withoutUrls, EMAIL_RE);
  for (const m of scan.matchAll(NUMBER_RE)) {
    const raw = m[0];
    const index = m.index ?? 0;
    const digits = digitsOf(raw);
    if (digits.length < MIN_DIGITS) continue;
    if (isDate(raw)) continue;
    const before = scan.slice(Math.max(0, index - 14), index);
    const after = scan.slice(index + raw.length, index + raw.length + 10);
    const looksLikeId = ID_NEARBY.test(scan.slice(Math.max(0, index - 40), index));
    if (!looksLikeId) {
      if (isThousandsGrouped(raw)) continue;
      if (MONEY_BEFORE.test(before) || MONEY_AFTER.test(after)) continue;
    }
    if (known.has(digits.slice(-MIN_DIGITS))) continue;
    findings.push({ index, length: raw.length, value: raw.trim() });
  }
  return findings;
}

/**
 * Oraciones CON su separador. A diferencia de la guarda de precios, el corte
 * es solo en `.`/`!`/`?` seguidos de espacio o fin de texto (y en cada salto
 * de línea): un email (`juan.perez@…`), un enlace o un «1.500» no parten la
 * oración, y así la oración que contiene el dato se reconoce entera.
 */
function sentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^\n]*?(?:[.!?]+(?=\s|$)|\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === "") {
      if (re.lastIndex >= text.length) break;
      re.lastIndex++;
      continue;
    }
    out.push(m[0]);
  }
  // Los espacios entre oraciones quedan pegados al comienzo de la siguiente.
  const joined = out.join("");
  if (joined.length < text.length) out.push(text.slice(joined.length));
  return out.length > 0 ? out : [text];
}

/**
 * Lo que usa el pipeline antes de enviar. `corpus` es TODO el contexto del
 * turno (system + mensajes + herramientas); `extraPhones`, el teléfono del
 * contacto con quien se habla (repetirle su propio número es legítimo).
 */
export function stripUnknownContactData(
  text: string | null | undefined,
  context: { corpus: string; extraPhones?: readonly string[] }
): PrivacyGuardResult {
  const original = text ?? "";
  if (!original.trim()) return { text: original, replaced: false, removed: [] };
  const extra = context.extraPhones ?? [];
  const findings = findUnknown(original, context.corpus, extra);
  if (findings.length === 0) return { text: original, replaced: false, removed: [] };

  // Se quita la ORACIÓN entera (como la guarda de precios): tachar el número
  // en el medio deja «llamala al ___», que es peor que no decir nada.
  const kept = sentences(original).filter(
    (sentence) => findUnknown(sentence, context.corpus, extra).length === 0
  );
  const rest = kept.join("").replace(/\n{3,}/g, "\n\n").trim();
  return {
    text: rest.length >= 20 ? rest : PRIVACY_FALLBACK,
    replaced: true,
    removed: findings.map((f) => f.value),
  };
}
