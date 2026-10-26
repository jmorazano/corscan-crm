import type { TrainerChangeType } from "@/server/ai/trainer-actions";
import { SYSTEM_MARKERS } from "@/server/mcp/markers";
import { foldAccents } from "./format";

/**
 * GUARDAS DE LA ENSEÑANZA DESDE CLAUDE (041, research D3). PURO.
 *
 * Claude lee mensajes que escribieron clientes; uno de ellos puede estar
 * armado para que Claude «le enseñe» al agente un enlace, un alias o un
 * teléfono del atacante, que después el agente repetiría a otros clientes
 * (y que la guarda de privacidad del envío ya no frenaría: estaría en el
 * conocimiento). Estas guardas corren en el CRM ANTES de aplicar y no
 * dependen de que el cliente MCP haya pedido confirmación.
 *
 * La regla: lo que el negocio NO cargó antes (enlaces, identificadores con
 * puntos como un alias, números largos, correos) no entra desde Claude; se
 * agrega desde el CRM. Los importes pasan: enseñar precios es uno de los usos
 * principales. Ante la duda se RECHAZA con el motivo: Claude puede reescribir
 * y el dueño puede cargarlo a mano, pero un dato del atacante en el agente
 * llega a todos los clientes.
 *
 * Todo se evalúa sobre el texto NORMALIZADO (`normalizeForGuard`): dígitos y
 * puntos de ancho completo, caracteres invisibles y guiones raros no sirven
 * para esconder nada (revisión de seguridad del 26-oct-2026).
 */

export type KnownEntry = {
  id: string;
  kind: "qa" | "block";
  question: string | null;
  answer: string | null;
  content: string | null;
};

export type TeachGuardContext = {
  /** Perfil + conocimiento actual de la empresa (lo que el agente ya sabe). */
  corpus: string;
  /** Hosts conocidos: los del corpus, el del CRM y los de sus integraciones. */
  allowedHosts: readonly string[];
  knownEntries: readonly KnownEntry[];
};

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

/** Textos que el cambio escribiría (los de un borrado no escriben nada). */
export function changeTexts(change: TrainerChangeType): string[] {
  switch (change.op) {
    case "kb_add":
    case "kb_update":
      return [change.question, change.answer, change.content].filter(
        (t): t is string => typeof t === "string" && t.length > 0
      );
    case "profile_set":
      return change.value ? [change.value] : [];
    case "profile_append":
      return [change.text];
    case "kb_delete":
      return [];
  }
}

/**
 * NFKC (ancho completo → ASCII), puntos ideográficos → «.», guiones
 * tipográficos → «-» y fuera los caracteres de formato (ancho cero, bidi,
 * guion blando): lo que un navegador o WhatsApp mostraría igual.
 */
export function normalizeForGuard(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[。｡﹒]/g, ".")
    .replace(/[‐-―−﹘﹣]/g, "-")
    .replace(/\p{Cf}/gu, "");
}

function fold(text: string): string {
  return foldAccents(text).toLowerCase();
}

const NUMBER_WORDS: Record<string, string> = {
  cero: "0", uno: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9",
};

/**
 * Para DETECTAR (no para guardar): dígitos dichos con palabras («tres cinco
 * uno»), «arroba»/«(at)» → «@», «punto»/«(dot)» y « . » → «.». Así un dato
 * escrito para esquivar la guarda se ve como lo leería una persona.
 */
export function deobfuscate(text: string): string {
  return fold(normalizeForGuard(text))
    .replace(/\b(cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/g, (w) => NUMBER_WORDS[w] ?? w)
    .replace(/\s*(?:\barroba\b|\(at\)|\[at\])\s*/g, "@")
    .replace(/\s*(?:\(dot\)|\[dot\]|\[\.\]|\(\.\)|\{\.\}|\bdot\b)\s*/g, ".")
    .replace(/(^|\s)@\s+(?=[a-z0-9._]{2,})/g, "$1@")
    .replace(/(?<=[\p{L}\p{N}])\s+(?:punto|\.)\s+(?=[\p{L}\p{N}])/gu, ".")
    // «pagos @ gmail.com» (espacios a los dos lados y un dominio después); «a @usuario» queda como usuario.
    .replace(/(?<=[\p{L}\p{N}])\s+@\s+(?=[\p{L}\p{N}][\p{L}\p{N}-]*\.)/gu, "@");
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const SCHEME_URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'«»]+/gi;
/**
 * Cualquier «palabra.palabra» con final de letras: un dominio suelto (WhatsApp
 * lo vuelve clicable con cualquier TLD) o un alias de pago. «Gracias.Saludos»
 * también cae acá: se rechaza y Claude lo reescribe con espacio.
 */
const DOTTED_RE =
  /(?<![\p{L}\p{N}@.\-_])((?:[\p{L}\p{N}](?:[\p{L}\p{N}_-]*[\p{L}\p{N}])?\.)+[\p{L}\p{N}_-]*\p{L}[\p{L}\p{N}_-]*)(?![\p{L}\p{N}@\-_])/gu;
/** IP suelta («45.9.12.3/pago»): un enlace sin nombre. */
const IP_RE = /(?<![\p{N}.])\d{1,3}(?:\.\d{1,3}){3}(?![\p{N}.])/gu;

function mask(text: string, re: RegExp): string {
  return text.replace(re, (m) => " ".repeat(m.length));
}

function normalizeHost(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "");
}

/** Host real de un enlace, como lo resuelve un navegador (`\` = `/`, `@`, IDNA). */
function hostOfUrl(raw: string): string | null {
  const trimmed = raw.replace(/[.,;:!?¡¿…"'»)\]}]+$/, "");
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.hostname ? normalizeHost(url.hostname) : null;
  } catch {
    return null;
  }
}

/** Hosts de los enlaces con esquema o con `www.` (el texto ya normalizado). */
export function extractHosts(text: string): string[] {
  // Sin enmascarar correos: «https://altos.com@pagos-x.xyz» parece uno y es un enlace a pagos-x.xyz.
  const t = normalizeForGuard(text);
  const out = new Set<string>();
  for (const m of t.matchAll(SCHEME_URL_RE)) {
    const host = hostOfUrl(m[0]);
    if (host) out.add(host);
  }
  return [...out];
}

/** «palabra.palabra» fuera de enlaces y correos: dominios sueltos y alias. */
/** Forma ASCII (punycode) de un token con forma de dominio, como lo resolvería un navegador. */
function asciiToken(token: string): string {
  try {
    return new URL(`https://${token}`).hostname || token;
  } catch {
    return token;
  }
}

export function extractDottedTokens(text: string): string[] {
  const t = mask(mask(deobfuscate(text), EMAIL_RE), SCHEME_URL_RE);
  const out = new Set<string>();
  const folded = t;
  for (const m of folded.matchAll(DOTTED_RE)) {
    const token = (m[1] ?? "").replace(/\.+$/, "");
    if (!token.includes(".")) continue;
    // «a.m.», «p.ej.», «S.A.»: abreviaturas (todas las partes de 1–2 letras),
    // salvo que sigan con una ruta («t.co/abc» es un enlace).
    const abbreviation = token.split(".").every((label) => label.length <= 2);
    const withPath = folded[(m.index ?? 0) + (m[1] ?? "").length] === "/";
    if (abbreviation && !withPath) continue;
    out.add(asciiToken(token));
  }
  for (const m of folded.matchAll(IP_RE)) out.add(m[0]);
  return [...out];
}

/** Igual o subdominio de un host conocido («reservas.altos.com» ⊂ «altos.com»). */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = normalizeHost(host);
  return allowed.some((a) => {
    const base = normalizeHost(a);
    return base.length > 0 && (h === base || h.endsWith(`.${base}`));
  });
}

/**
 * Alias SIN puntos cerca de un aviso de pago («transferí al alias
 * pagosrapidos», «el alias de la cuenta es pagosrapidos», «Mercado Pago a
 * pagosrapidos»): el primer término de 6+ caracteres en las 8 palabras
 * siguientes que no sea una palabra común. Con puntos ya lo toma `DOTTED_RE`.
 * Ante la duda rechaza: los datos de pago se cargan desde el CRM.
 */
const ALIAS_KEYWORD_RE =
  /\b(?:alias|cbu|cvu|transferi|transferir|transferencia|transferencias|deposita|depositar|deposito|mercado ?pago)\b([^\n]{0,120})/g;
const ALIAS_STOPWORDS = new Set([
  "transferir", "transferi", "transferencia", "transferencias", "mercado", "cuenta", "bancaria", "bancario",
  "equipo", "nuestro", "nuestra", "nuestros", "consultar", "consultalo", "pedirlo", "pedilo", "whatsapp",
  "siempre", "correcto", "tenemos", "informamos", "enviamos", "pasamos", "despues", "recibir", "reserva",
  "reservar", "cuando", "porque", "nombre", "titular", "abajo", "arriba", "figura", "aparece", "mismo",
  "tambien", "comprobante", "deposito", "pagar", "pagina", "efectivo", "tarjeta", "credito", "debito",
  "cuotas", "contado", "recargo", "descuento", "intereses", "interes", "bancarias", "bancarios", "enviar",
  "envianos", "mandanos", "mandar", "antes", "confirmar", "confirmamos", "confirmacion", "senia", "adelanto",
  "saldo", "restante", "llegada", "ingreso", "importe", "monto", "total", "porcentaje", "reservas",
  "aceptamos", "recibimos", "podes", "puede", "pueden", "hacer", "hacerla", "hacerlo", "medios", "opciones",
  "alojamiento", "cabana", "cabanas", "noche", "noches", "persona", "personas", "tambien", "ademas",
]);

export function extractNamedAliases(text: string): string[] {
  const out: string[] = [];
  for (const m of deobfuscate(text).matchAll(ALIAS_KEYWORD_RE)) {
    const words = (m[1] ?? "").split(/[\s:=→>]+/).filter(Boolean).slice(0, 8);
    for (const raw of words) {
      const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (word.length < 6 || ALIAS_STOPWORDS.has(word)) continue;
      out.push(word);
      break;
    }
  }
  return out;
}

/**
 * Números «de contacto»: dígitos con huecos de hasta 6 caracteres que no son
 * letras, monedas ni salto de línea, o una letra suelta («351–555–1234»,
 * «351/555/1234», «351a555a1234», «351 y 555 y 1234»).
 */
const NUMBER_RE = /\+?\d(?:(?:[^\p{L}\p{N}\n$€]|(?<!\p{L})\p{L}(?!\p{L})){0,6}\d)+/gu;
const MIN_DIGITS = 8;
const THOUSANDS_RE = /^\d{1,3}(\.\d{3})+(,\d+)?$/;
const DATE_RE = /^(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2})$/;
/** Sin moneda, un importe con miles cuenta como importe hasta 9.999.999 (un teléfono tiene 10 dígitos). */
const MAX_BARE_AMOUNT_DIGITS = 7;
const CURRENCY_BEFORE = /(\$|usd|us\$|u\$s|ars|eur|€)\s*$/i;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const YEAR_RE = /^(19|20)\d{2}$/;

function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

/** Últimos 8 dígitos de todo número largo del corpus (formateado o pegado). */
function knownNumbers(corpus: string): Set<string> {
  const out = new Set<string>();
  for (const m of corpus.matchAll(NUMBER_RE)) {
    const d = digitsOf(m[0]);
    if (d.length >= MIN_DIGITS) out.add(d.slice(-MIN_DIGITS));
  }
  for (const m of corpus.matchAll(/\d{8,}/g)) out.add(m[0].slice(-MIN_DIGITS));
  return out;
}

/**
 * ¿Es un importe o una fecha y no un teléfono? Solo si TODAS sus partes lo
 * son: importes con separador de miles y la moneda justo antes («$ 85.000 -
 * 120.000»), o fechas («15-12-2026 / 28-02-2027»). «precio: 3515551234» o
 * «$ 351-555-1234» NO pasan.
 */
function isAmountOrDate(candidate: string, before: string): boolean {
  const currency = CURRENCY_BEFORE.test(before);
  const harmless = (p: string): boolean =>
    DATE_RE.test(p) ||
    TIME_RE.test(p) ||
    YEAR_RE.test(p) ||
    (THOUSANDS_RE.test(p) && (currency || digitsOf(p).length <= MAX_BARE_AMOUNT_DIGITS));
  const parts = candidate
    .split(/[^\d.,:/-]+/)
    .map((p) => p.replace(/^[.,:/-]+|[.,:/-]+$/g, ""))
    .filter((p) => /\d/.test(p));
  if (parts.length === 0) return false;
  // «09:00-13:00», «15/12-28/02»: un rango se mira por sus dos lados.
  return parts.every((p) => harmless(p) || p.split("-").every((q) => q !== "" && harmless(q)));
}

/**
 * Un número dicho con palabras compuestas («tres cincuenta y uno, quinientos
 * cincuenta y cinco…», «three five one…»): 5 o más palabras de número
 * seguidas, unidas solo por espacios, comas, guiones o «y»/«and».
 */
const NUMBER_WORD =
  "(?:cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci\\p{L}+|veinte|veinti\\p{L}+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil|zero|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)";
const SPELLED_NUMBER_RE = new RegExp(
  `(?<!\\p{L})${NUMBER_WORD}(?:(?:[\\s,;.-]+|\\s+(?:y|and)\\s+)${NUMBER_WORD}){4,}(?!\\p{L})`,
  "u"
);

export function hasSpelledNumber(text: string): boolean {
  const t = fold(normalizeForGuard(text));
  const m = SPELLED_NUMBER_RE.exec(t);
  if (!m) return false;
  // Solo cifras («1, 2, 3, 4 y 5», «85.000, 120.000 y 150.000»): eso lo mira el detector de números.
  return !/^[\d\s,;.y-]+$/.test(m[0]);
}

/** Números de ≥ 8 dígitos y correos de `text` que el corpus no tiene. */
export function findUnknownContactData(text: string, corpus: string): string[] {
  const t = deobfuscate(text);
  const c = deobfuscate(corpus);
  const lowerCorpus = c.toLowerCase();
  const found: string[] = [];
  for (const m of t.matchAll(EMAIL_RE)) {
    if (!lowerCorpus.includes(m[0].toLowerCase())) found.push(m[0]);
  }
  const known = knownNumbers(mask(c, EMAIL_RE));
  const scan = mask(mask(t, EMAIL_RE), SCHEME_URL_RE);
  for (const m of scan.matchAll(NUMBER_RE)) {
    const digits = digitsOf(m[0]);
    if (digits.length < MIN_DIGITS) continue;
    const index = m.index ?? 0;
    if (isAmountOrDate(m[0], scan.slice(Math.max(0, index - 6), index))) continue;
    if (known.has(digits.slice(-MIN_DIGITS))) continue;
    found.push(m[0].trim());
  }
  return found;
}

/** Datos que pueden ser de un contacto: teléfonos (≥ 8 dígitos), correos y `@usuario`. */
export function extractContactKeys(text: string): { phones: string[]; emails: string[]; handles: string[] } {
  const t = deobfuscate(text);
  const emails = [...t.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase());
  const noEmails = mask(t, EMAIL_RE);
  const phones = [...noEmails.matchAll(NUMBER_RE)].map((m) => digitsOf(m[0])).filter((d) => d.length >= MIN_DIGITS);
  const handles = [...noEmails.matchAll(/(?<![\w.])@([a-z0-9._]{2,30})/gi)].map((m) =>
    (m[1] ?? "").replace(/\.+$/, "").toLowerCase()
  );
  return { phones, emails, handles };
}

/**
 * `[ADJUNTO]`, `[COMPROBANTE_PLANILLA]`, `[IMAGEN_ENTRENADOR]` y los que
 * vengan: en MAYÚSCULAS, como los escribe el sistema («[ver abajo]» no es uno).
 * Los marcadores con nombre (`SYSTEM_MARKERS`) se buscan sin mayúsculas ni tildes.
 */
const MARKER_TOKEN_RE = /\[[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ_]{2,}\]/;
const FOLDED_MARKERS = SYSTEM_MARKERS.map(fold);

export function hasInternalMarker(text: string): boolean {
  const t = normalizeForGuard(text);
  if (MARKER_TOKEN_RE.test(t)) return true;
  const f = fold(t);
  return FOLDED_MARKERS.some((m) => f.includes(m));
}

/** Para comparar entradas: sin tildes, sin mayúsculas, espacios colapsados, sin puntuación final. */
export function normalizeKbText(text: string | null | undefined): string {
  return fold(normalizeForGuard(text ?? ""))
    .replace(/\s+/g, " ")
    .replace(/[\s.!?¡¿]+$/g, "")
    .replace(/^[\s¡¿]+/, "")
    .trim();
}

function duplicateOf(change: TrainerChangeType, entries: readonly KnownEntry[]): KnownEntry | null {
  if (change.op !== "kb_add") return null;
  if (change.kind === "qa") {
    const q = normalizeKbText(change.question);
    if (!q) return null;
    return entries.find((e) => e.kind === "qa" && normalizeKbText(e.question) === q) ?? null;
  }
  const c = normalizeKbText(change.content);
  if (!c) return null;
  return entries.find((e) => e.kind === "block" && normalizeKbText(e.content) === c) ?? null;
}

const FROM_CRM = "si es del negocio, agregalo desde el CRM (Agente → Conocimiento) y después Claude ya lo puede usar.";

/** Una sola guarda por cambio, en orden de gravedad; el primer motivo gana. */
export function checkTeachChange(change: TrainerChangeType, ctx: TeachGuardContext): GuardVerdict {
  const fields = changeTexts(change);
  if (fields.length === 0) return { ok: true };
  // Cada campo y además todos juntos: un dato partido entre pregunta y respuesta.
  const texts = fields.length > 1 ? [...fields, fields.join(" ")] : fields;
  const corpusTokens = new Set(extractDottedTokens(ctx.corpus));
  const corpusFolded = deobfuscate(ctx.corpus);

  for (const text of texts) {
    if (hasInternalMarker(text)) {
      return { ok: false, reason: "Tiene un marcador interno del sistema: no se puede enseñar ese texto." };
    }
  }
  for (const text of texts) {
    for (const host of extractHosts(text)) {
      if (!hostAllowed(host, ctx.allowedHosts)) return { ok: false, reason: `Enlace nuevo (${host}): ${FROM_CRM}` };
    }
    for (const token of extractDottedTokens(text)) {
      if (!corpusTokens.has(token) && !hostAllowed(token, ctx.allowedHosts)) {
        return { ok: false, reason: `Enlace o alias nuevo (${token}): ${FROM_CRM}` };
      }
    }
    for (const alias of extractNamedAliases(text)) {
      if (!new RegExp(`(?<![\\p{L}\\p{N}.])${alias.replace(/[.\-]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(corpusFolded)) {
        return { ok: false, reason: `Dato de pago nuevo (${alias}): los alias y CBU se cargan desde el CRM, nunca desde Claude.` };
      }
    }
    for (const handle of extractContactKeys(text).handles) {
      if (!new RegExp(`@${handle.replace(/[.]/g, "\\.")}(?![\\p{L}\\p{N}._])`, "u").test(corpusFolded)) {
        return { ok: false, reason: `Usuario nuevo (@${handle}): ${FROM_CRM}` };
      }
    }
    if (hasSpelledNumber(text)) {
      return { ok: false, reason: `Un número escrito con palabras: ${FROM_CRM}` };
    }
    const unknown = findUnknownContactData(text, ctx.corpus);
    if (unknown.length > 0) {
      return { ok: false, reason: `Teléfono, número o correo que el agente no conoce (${unknown[0]}): ${FROM_CRM}` };
    }
  }
  const dup = duplicateOf(change, ctx.knownEntries);
  if (dup) {
    return {
      ok: false,
      reason:
        dup.kind === "qa"
          ? `Ya existe una P/R con esa pregunta (${dup.id}): corregila con edit_agent.`
          : `Ya existe ese bloque (${dup.id}).`,
    };
  }
  return { ok: true };
}
