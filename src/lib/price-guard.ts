/**
 * GUARDA DE PRECIOS EN EL MENSAJE (021).
 *
 * POR QUÉ EXISTE
 * --------------
 * El dueño del negocio de alojamientos decidió mantener la regla que ya
 * tenía su agente anterior: **los importes no se escriben por WhatsApp**.
 * Los valores, las condiciones y la seña se ven al entrar a la ficha, que
 * es además donde se reserva. El agente SÍ recibe los precios —los necesita
 * para ordenar las opciones y para poder decir cuál es la más económica—,
 * pero no los transcribe.
 *
 * Como en `promise-guard.ts` (016, D20), el prompt es una instrucción y no
 * una garantía: el modelo puede escribir «sale $300.000» igual. Esta guarda
 * corre sobre el TEXTO SALIENTE, justo antes de enviarlo, y es el único
 * cinturón que no depende de que el modelo obedezca.
 *
 * CÓMO CORRIGE
 * ------------
 * Quita la ORACIÓN que contiene el importe, no el importe suelto. Redactar
 * el número en el medio deja frases rotas («La cabaña sale ___ el total»);
 * las oraciones de precio son casi siempre autocontenidas, así que sacarlas
 * enteras deja un mensaje que se lee bien. Si al sacarlas no queda nada, se
 * manda una frase que remite al enlace.
 *
 * QUÉ NO DEBE HACER
 * -----------------
 * Dispararse de más. El agente escribe números todo el tiempo y son
 * legítimos: fechas («del 12/10 al 15/10»), cantidades («4 personas», «3
 * dormitorios»), códigos («AC-006»), horarios y teléfonos. Por eso cada
 * patrón exige una MARCA DE DINERO: el signo `$`, el código de moneda, o la
 * palabra «peso/pesos» junto a un número. Sin marca de dinero, no hay
 * match.
 *
 * MÓDULO PURO
 * -----------
 * Sin imports, sin estado, sin I/O.
 */

export interface PriceMentionMatch {
  mentions: boolean;
  /** Fragmento ORIGINAL que disparó, para el registro del incidente. */
  match: string | null;
}

export interface GuardedPriceReply {
  text: string;
  replaced: boolean;
  match: string | null;
}

/** Números escritos con palabras que acompañan a «pesos». */
const NUMERO_PALABRA =
  "(?:un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|" +
  "veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|" +
  "cientos|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|" +
  "ochocientos|novecientos|mil|millon|millones|millón)";

/**
 * Cada patrón lleva su marca de dinero. El orden no importa: se reporta el
 * match que aparece primero en el texto.
 */
const PATRONES: { id: string; patron: RegExp }[] = [
  // «$300.000», «$ 1200», «AR$ 50.000», «US$ 100»
  { id: "signo-peso", patron: /(?:AR|US|U\$S|R)?\$\s?\d[\d.,]*/gi },
  // «ARS 300000», «300000 ARS», «USD 50»
  { id: "codigo-moneda", patron: /\b(?:ARS|USD|EUR)\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:ARS|USD|EUR)\b/gi },
  // «300.000 pesos», «1200 pesos argentinos»
  { id: "digitos-pesos", patron: /\b\d[\d.,]*\s*(?:mil\s+)?pesos?\b/gi },
  // «trescientos mil pesos», «ciento cincuenta mil pesos»
  {
    id: "palabras-pesos",
    patron: new RegExp(`\\b${NUMERO_PALABRA}(?:\\s+(?:y\\s+)?${NUMERO_PALABRA})*\\s+pesos?\\b`, "gi"),
  },
  // «sale 300 lucas», «450 palos» — jerga, misma intención
  { id: "jerga", patron: /\b\d[\d.,]*\s*(?:lucas|luca|palos|palo|mangos)\b/gi },
];

/**
 * ¿El texto saliente menciona un importe? Devuelve el primer fragmento
 * infractor tal como estaba escrito.
 */
export function detectPriceMention(text: string | null | undefined): PriceMentionMatch {
  const original = text ?? "";
  if (!original.trim()) return { mentions: false, match: null };

  let mejor: { indice: number; largo: number } | null = null;
  for (const { patron } of PATRONES) {
    patron.lastIndex = 0;
    const encontrado = patron.exec(original);
    if (!encontrado || !encontrado[0]) continue;
    const indice = encontrado.index;
    if (!mejor || indice < mejor.indice) {
      mejor = { indice, largo: encontrado[0].length };
    }
  }
  if (!mejor) return { mentions: false, match: null };
  return { mentions: true, match: original.slice(mejor.indice, mejor.indice + mejor.largo) };
}

/**
 * Corta el texto en oraciones CONSERVANDO su separador, para poder volver a
 * armarlo sin inventar puntuación. Los saltos de línea cuentan como corte:
 * una lista de opciones con el precio en cada renglón se limpia renglón por
 * renglón.
 *
 * OJO con el punto: en español es TAMBIÉN el separador de miles, así que un
 * `.` entre dígitos NO termina una oración. Sin esta excepción, «$600.000»
 * se partía al medio y el reemplazo dejaba un «.000).» suelto en el mensaje
 * que sale a WhatsApp.
 */
function enOraciones(text: string): string[] {
  const piezas: string[] = [];
  let desde = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === "\n") {
      piezas.push(text.slice(desde, i + 1));
      desde = i + 1;
      continue;
    }
    if (c !== "." && c !== "!" && c !== "?") continue;
    const anterior = text[i - 1] ?? "";
    const siguiente = text[i + 1] ?? "";
    if (c === "." && /\d/.test(anterior) && /\d/.test(siguiente)) continue;
    // Puntuación repetida («…», «!?») termina una sola vez.
    let fin = i;
    while (fin + 1 < text.length && /[.!?]/.test(text[fin + 1]!)) fin += 1;
    piezas.push(text.slice(desde, fin + 1));
    desde = fin + 1;
    i = fin;
  }
  if (desde < text.length) piezas.push(text.slice(desde));
  return piezas.length > 0 ? piezas : [text];
}

/** La frase de reemplazo cuando el mensaje entero hablaba de plata. */
export function safePriceReply(link?: string | null): string {
  const enlace = (link ?? "").trim();
  const usable = enlace.startsWith("https://") && !/\s/.test(enlace) ? enlace : null;
  if (usable) {
    return `Los valores y las condiciones los podés ver en la ficha del alojamiento 👉 ${usable}`;
  }
  return "Los valores y las condiciones los podés ver en la ficha del alojamiento, desde el enlace.";
}

/**
 * Lo que usa el pipeline antes de enviar. Devuelve `replaced` y `match` para
 * que quien llama registre el incidente.
 */
export function stripPrices(
  text: string | null | undefined,
  options?: { link?: string | null }
): GuardedPriceReply {
  const original = text ?? "";
  const deteccion = detectPriceMention(original);
  if (!deteccion.mentions) {
    return { text: original, replaced: false, match: null };
  }

  const limpias = enOraciones(original).filter(
    (oracion) => !detectPriceMention(oracion).mentions
  );
  const restante = limpias.join("").replace(/\n{3,}/g, "\n\n").trim();

  // Un resto demasiado corto no es un mensaje: es la ruina de uno. Mejor la
  // frase completa que «Claro!» solo.
  const utilizable = restante.length >= 25 ? restante : "";

  // Si lo que quedó YA lleva un enlace, la coletilla no suma otro: un
  // mensaje de WhatsApp con dos enlaces previsualiza solo el primero y el
  // resto queda como un muro (misma razón que la corrección #53 de 016).
  const yaHayEnlace = /https?:\/\//.test(utilizable);
  const coletilla = yaHayEnlace ? safePriceReply(null) : safePriceReply(options?.link);

  return {
    text: utilizable ? `${utilizable}\n\n${coletilla}` : safePriceReply(options?.link),
    replaced: true,
    match: deteccion.match,
  };
}
