/**
 * GUARDA DE PROMESAS DE RESERVA (016, corrección #42 · research D20).
 *
 * POR QUÉ EXISTE
 * --------------
 * El servicio del PMS que consulta el agente **solo informa**: devuelve
 * disponibilidad, precios y un enlace. No reserva, no seña, no cobra. La
 * allowlist de herramientas (`profile.allowedTools`) garantiza que el agente
 * no pueda EJECUTAR una reserva; no garantiza que no la PROMETA.
 *
 * El riesgo real no es que el modelo llame a una herramienta inexistente: es
 * que escriba `{"action":"reply","text":"Dale, te la reservo y te confirmo"}`.
 * Zod acepta cualquier string en `reply`, el prompt es una instrucción (no una
 * garantía) y una reserva prometida y no cumplida es peor que no responder —
 * es la regla de negocio que el dueño puso como condición de la feature.
 *
 * Por eso esta guarda corre sobre el TEXTO SALIENTE, justo antes de enviarlo:
 * es el único de los cinco cinturones anti-promesa que no depende de que el
 * modelo obedezca, y al ser puro el E2E puede forzarlo con un knob del ai-mock
 * (`forcePromise`) y verlo fallar. Un paso de prueba que no puede fallar no
 * prueba nada.
 *
 * QUÉ NO DEBE HACER
 * -----------------
 * Dispararse de más. Si la guarda saltara con «para reservar entrá al enlace»
 * o «la seña se paga al reservar», el agente perdería la capacidad de explicar
 * CÓMO se reserva, que es exactamente lo que tiene que hacer. Los falsos
 * positivos son el modo de falla caro; por eso cada patrón exige una marca de
 * compromiso (primera persona, clítico, participio de estado) y hay dos
 * eximentes explícitas: la negación adyacente («no te la reservo, la hacés
 * vos») y el condicional de estado («queda confirmada cuando completás el
 * pago en el sitio»).
 *
 * MÓDULO PURO
 * -----------
 * Sin imports, sin estado, sin I/O: entra texto, sale texto. Registrar el
 * incidente y contarlo es trabajo de quien llama (el pipeline), que tiene
 * `replaced` y `match` para hacerlo. Así se puede probar la regla sin base de
 * datos y usarla desde cualquier capa.
 */

/** Resultado de la detección. `match` es el fragmento ORIGINAL que disparó. */
export interface BookingPromiseMatch {
  promises: boolean;
  match: string | null;
}

/** Resultado del reemplazo listo para enviar. */
export interface GuardedReply {
  /** Texto final: el original si estaba limpio, la frase segura si no. */
  text: string;
  /** true si la guarda tuvo que intervenir (el incidente se registra afuera). */
  replaced: boolean;
  /** Fragmento que disparó la guarda, para el registro del incidente. */
  match: string | null;
}

// ---------------------------------------------------------------------------
// Normalización (preserva longitud, para poder recortar el texto ORIGINAL)
// ---------------------------------------------------------------------------

/**
 * Tildes y diéresis a su letra base, uno a uno. NO se usa `normalize("NFD")`
 * porque cambia la longitud de la cadena y rompería el mapeo de índices con
 * el texto original (que es de donde sale el `match` que se registra).
 */
const SIN_TILDE: Record<string, string> = {
  á: "a", à: "a", ä: "a", â: "a", ã: "a", å: "a",
  é: "e", è: "e", ë: "e", ê: "e",
  í: "i", ì: "i", ï: "i", î: "i",
  ó: "o", ò: "o", ö: "o", ô: "o", õ: "o",
  ú: "u", ù: "u", ü: "u", û: "u",
  ñ: "n", ç: "c", ý: "y",
};

/**
 * Minúsculas, sin tildes, sin puntuación ni emojis (cada carácter ajeno pasa
 * a ser un espacio). Longitud EXACTAMENTE igual a la del texto de entrada:
 * los patrones corren sobre esta versión y los índices sirven para el original.
 * Cubre de paso los errores de tilde del modelo («te lo reserve»).
 */
function normalizar(texto: string): string {
  let salida = "";
  for (let i = 0; i < texto.length; i += 1) {
    const crudo = texto.charAt(i);
    const minuscula = crudo.toLowerCase().charAt(0) || crudo;
    const base = SIN_TILDE[minuscula] ?? minuscula;
    salida += /[a-z0-9\s]/.test(base) ? base : " ";
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Vocabulario de los patrones
// ---------------------------------------------------------------------------

/** Verbos de RETENER una unidad: no hay lectura inocente de estos en 1ª persona. */
const RETENER = "reserv|bloque|apart|separ|congel|reteng";

/** Terminaciones de primera persona (presente y pretérito, singular y plural). */
const FIN_1P = "(?:o|e|amos|emos)";

/** Lo que se reserva: sustantivos que vuelven inequívoco un verbo ambiguo. */
const OBJETO =
  "(?:caban[ao]s?|cas[ao]s?|unidad(?:es)?|propiedad(?:es)?|alojamientos?|" +
  "lugar(?:es)?|habitacion(?:es)?|dept[oa]s?|departamentos?|estadias?|" +
  "noches?|finde|fin\\s+de\\s+semana|fechas?|reservas?|complejos?)";

/** Participios de «esto ya está tomado». */
const PARTICIPIO =
  "(?:reservad|tomad|guardad|bloquead|apartad|separad|confirmad|asegurad|congelad|agendad)[oa]s?";

/**
 * Familia de la regla:
 * - `compromiso`: el agente dice que HACE algo («te la reservo»).
 * - `estado`: el agente afirma que algo QUEDÓ hecho («queda reservada»).
 *   Solo esta familia admite la eximente del condicional, porque «queda
 *   confirmada cuando pagás en el sitio» es una explicación correcta.
 */
type Familia = "compromiso" | "estado";

interface Regla {
  id: string;
  familia: Familia;
  patron: RegExp;
}

const REGLAS: Regla[] = [
  // «(ya) te (la) reservo / bloqueo / aparto / separo / congelo»
  {
    id: "te-clitico-retener",
    familia: "compromiso",
    patron: new RegExp(
      `\\b(?:ya\\s+)?te\\s+(?:(?:la|lo|las|los|le|les)\\s+)?(?:${RETENER})${FIN_1P}\\b`,
      "g"
    ),
  },
  // «(ya) la reservé / lo bloqueo» — sin «te», con clítico de objeto
  {
    id: "clitico-retener",
    familia: "compromiso",
    patron: new RegExp(
      `\\b(?:ya\\s+)?(?:la|lo|las|los)\\s+(?:${RETENER})${FIN_1P}\\b`,
      "g"
    ),
  },
  // «reservé la cabaña» / «bloqueo la unidad» — verbo suelto con objeto claro
  {
    id: "retener-objeto",
    familia: "compromiso",
    patron: new RegExp(
      `\\b(?:ya\\s+)?(?:${RETENER})${FIN_1P}\\s+(?:la|el|una?|tu|su|esa|ese|dos|las|los)\\s+${OBJETO}\\b`,
      "g"
    ),
  },
  // Futuro perifrástico: «te la voy a reservar», «vamos a guardarte la cabaña»
  {
    id: "futuro-perifrastico",
    familia: "compromiso",
    patron: new RegExp(
      "\\b(?:te\\s+)?(?:(?:la|lo|las|los)\\s+)?(?:voy|vamos|paso)\\s+a\\s+" +
        "(?:reservar|bloquear|apartar|separar|guardar|congelar|retener|dejar)" +
        "(?:te|la|lo|las|los|sela|selo|mela)?\\b",
      "g"
    ),
  },
  // Ofrecimiento en primera persona: «puedo reservarte la cabaña».
  // La marca es la PERSONA: «podés reservarla desde la página» es la
  // instrucción correcta al cliente y no matchea.
  {
    id: "puedo-retener",
    familia: "compromiso",
    patron: new RegExp(
      "\\b(?:puedo|podemos|podria|podriamos)\\s+" +
        "(?:reservar|bloquear|apartar|separar|guardar|congelar|retener)" +
        "(?:te|la|lo|las|los|tela|telo)?\\b",
      "g"
    ),
  },
  // Gerundio: «estoy reservando la cabaña»
  {
    id: "gerundio",
    familia: "compromiso",
    patron: new RegExp(
      "\\b(?:te\\s+)?(?:(?:la|lo|las|los)\\s+)?(?:estoy|estamos)\\s+" +
        "(?:reservand|guardand|bloqueand|apartand|separand|congeland)o\\b",
      "g"
    ),
  },
  // «te la dejo / te la guardo / te la tomo» (no «te lo tomo como un sí»)
  {
    id: "te-clitico-retener-debil",
    familia: "compromiso",
    patron: new RegExp(
      `\\b(?:ya\\s+)?te\\s+(?:la|lo|las|los)\\s+(?:dej|guard|tom|aguant|manteng|gestion)${FIN_1P}\\b(?!\\s+como\\b)`,
      "g"
    ),
  },
  // «te guardo la cabaña» — verbo ambiguo, desambiguado por el objeto
  {
    id: "retener-debil-objeto",
    familia: "compromiso",
    patron: new RegExp(
      `\\bte\\s+(?:guard|aguant|manteng|gestion)${FIN_1P}\\s+(?:la|el|una?|tu|su|esa|ese)\\s+${OBJETO}\\b`,
      "g"
    ),
  },
  // «me encargo de la reserva / de reservarla»
  {
    id: "me-encargo",
    familia: "compromiso",
    patron: new RegExp(
      "\\bme\\s+encargo\\s+(?:yo\\s+)?(?:de\\s+)?" +
        "(?:la\\s+reserva|reservar|bloquear|guardar|apartar)(?:la|lo|las|los|te)?\\b",
      "g"
    ),
  },
  // «te la confirmo» — con clítico, el objeto es la reserva
  {
    id: "te-clitico-confirmo",
    familia: "compromiso",
    patron: new RegExp(`\\bte\\s+(?:la|lo)\\s+confirm${FIN_1P}\\b`, "g"),
  },
  // «te confirmo la reserva» — sin clítico exige el objeto explícito, para no
  // pisar «te confirmo que hay lugar», que es correcto y necesario.
  {
    id: "confirmo-objeto",
    familia: "compromiso",
    patron: new RegExp(
      `\\bte\\s+confirm${FIN_1P}\\s+(?:ya\\s+)?(?:la|el|tu|su)\\s+${OBJETO}\\b`,
      "g"
    ),
  },
  // «te tomo la seña» / «te acepto la seña»: señar es tomar la reserva.
  {
    id: "sena-tomada",
    familia: "compromiso",
    patron: new RegExp(
      "\\b(?:te\\s+)?(?:tom|acept|recib|cobr|pas)\\w*\\s+(?:la|una|tu|el)\\s+sen(?:a|as)\\b",
      "g"
    ),
  },
  // «seña por transferencia», «señá por depósito»
  {
    id: "sena-medio-de-pago",
    familia: "compromiso",
    patron: new RegExp(
      "\\bsen(?:a|as|ame|amos|ala|alo)\\s+(?:por|con|via|al)\\s+" +
        "(?:transferencia|deposito|mercado|efectivo|cbu|alias)\\b",
      "g"
    ),
  },
  // Estado: «queda reservada», «ya está confirmado», «te la tengo apartada»
  {
    id: "estado-participio",
    familia: "estado",
    patron: new RegExp(
      `\\b(?:ya\\s+)?(?:te\\s+)?(?:(?:la|lo|las|los)\\s+)?` +
        `(?:qued(?:a|o|an|amos|aron)|est(?:a|an)|dej(?:o|amos)|teng(?:o|amos)|tenemos)\\s+` +
        `(?:(?:la|el|tu|su|esa|ese|las|los)\\s+\\w+\\s+)?${PARTICIPIO}\\b`,
      "g"
    ),
  },
  // Estado: «reserva confirmada» / «confirmada tu reserva»
  {
    id: "estado-reserva-confirmada",
    familia: "estado",
    patron: new RegExp(
      "\\b(?:reservas?\\s+confirmad[ao]s?|confirmad[ao]s?\\s+(?:la|tu|su)\\s+reservas?)\\b",
      "g"
    ),
  },
  // Estado: «queda a tu nombre»
  {
    id: "estado-a-tu-nombre",
    familia: "estado",
    patron: new RegExp(
      "\\b(?:qued(?:a|o|an)|te\\s+(?:la|lo)\\s+dej(?:o|amos)|va)\\s+a\\s+(?:tu|su)\\s+nombre\\b",
      "g"
    ),
  },
  // Cierre suelto: «listo, reservada» / «perfecto, confirmada»
  {
    id: "marcador-participio",
    familia: "estado",
    patron: new RegExp(
      `\\b(?:listo|lista|hecho|dale|perfecto|genial|ok|okey|buenisimo)\\s+(?:ya\\s+)?(?:esta\\s+)?${PARTICIPIO}\\b`,
      "g"
    ),
  },
];

// ---------------------------------------------------------------------------
// Eximentes
// ---------------------------------------------------------------------------

/**
 * Negación ADYACENTE: «no te la reservo», «yo no la bloqueo», «nunca te la
 * guardo». Se exige que el «no» esté pegado (a lo sumo una palabra de por
 * medio) para no perdonar «no te preocupes, te la reservo», que sí promete.
 */
const NEGACION = /\b(?:no|nunca|jamas|tampoco)\s+(?:\w+\s+)?$/;

function estaNegado(plano: string, indice: number): boolean {
  return NEGACION.test(plano.slice(Math.max(0, indice - 28), indice));
}

/**
 * Condicional de estado: «queda confirmada CUANDO completás el pago en el
 * sitio» no promete nada, explica el procedimiento. Solo se aplica a la
 * familia `estado`; ninguna condición vuelve inocente un «te la reservo».
 */
const CONDICIONAL =
  /\b(?:cuando|una\s+vez|recien|apenas|luego\s+de|despues\s+de|si\s+(?:la|lo)\s+(?:pag|complet|confirm|reserv)|al\s+(?:pagar|abonar|completar|confirmar|reservar))/;

function esCondicional(plano: string, fin: number): boolean {
  return CONDICIONAL.test(plano.slice(fin, fin + 60));
}

/**
 * Descripción del PROCESO, no promesa: «la reserva se hace online y queda
 * confirmada al instante». La marca se busca SOLO ANTES del match: si se
 * mirara también después, «queda reservada, te paso el enlace del sitio»
 * quedaría perdonada, y eso sí es una promesa.
 */
const PROCESO =
  /\b(?:se\s+(?:hace|hacen|completa|completan|confirma|confirman|toma|toman|gestiona|abona|paga)|online|en\s+el\s+sitio|en\s+la\s+web|en\s+la\s+pagina|desde\s+el\s+sitio|en\s+el\s+enlace)/;

function describeElProceso(
  plano: string,
  original: string,
  indice: number
): boolean {
  const desde = Math.max(0, indice - 45);
  const encontrado = PROCESO.exec(plano.slice(desde, indice));
  if (!encontrado) return false;
  const finMarcador = desde + encontrado.index + (encontrado[0]?.length ?? 0);
  // La eximente vale solo DENTRO de la misma oración: «se paga online. Queda
  // reservada.» son dos frases y la segunda promete. El corte se busca en el
  // texto ORIGINAL porque la normalización convierte la puntuación en espacios
  // (y por eso conserva la longitud: los índices siguen siendo los mismos).
  return !/[.;:!?\n]/.test(original.slice(finMarcador, indice));
}

/**
 * La unidad está tomada POR OTRO: «esas fechas ya están reservadas por otro
 * huésped» informa que NO hay lugar. Es lo contrario de una promesa y el
 * agente tiene que poder decirlo.
 */
const OTRO_DUENIO =
  /\b(?:por|para)\s+(?:otr[oa]s?|un[a]?\s+(?:huesped|grupo|familia|pareja|cliente|contingente))/;

function esDeOtro(plano: string, fin: number): boolean {
  return OTRO_DUENIO.test(plano.slice(fin, fin + 45));
}

/**
 * «Te lo dejo anotado y te aviso» es tomar nota, no retener una cabaña; el
 * agente lo dice todo el tiempo. La eximente se cae si la anotación es, justo,
 * de algo reservado («te la dejo anotada como reservada»).
 */
const ANOTACION = /^\s+(?:anotad|apuntad)[oa]s?\b/;
const ANOTACION_DE_RESERVA = /\bcomo\s+(?:reservad|tomad|guardad|bloquead|confirmad)/;

function esSoloAnotacion(plano: string, fin: number): boolean {
  const cola = plano.slice(fin, fin + 60);
  return ANOTACION.test(cola) && !ANOTACION_DE_RESERVA.test(cola);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * ¿El texto saliente promete una reserva? Devuelve el primer fragmento
 * infractor (en su forma ORIGINAL, con tildes y mayúsculas) para el registro
 * del incidente.
 */
export function detectBookingPromise(
  text: string | null | undefined
): BookingPromiseMatch {
  const original = text ?? "";
  if (!original.trim()) return { promises: false, match: null };

  const plano = normalizar(original);
  let mejor: { indice: number; largo: number } | null = null;

  for (const regla of REGLAS) {
    regla.patron.lastIndex = 0;
    for (
      let encontrado = regla.patron.exec(plano);
      encontrado !== null;
      encontrado = regla.patron.exec(plano)
    ) {
      const bruto = encontrado[0] ?? "";
      if (bruto.length === 0) {
        regla.patron.lastIndex += 1;
        continue;
      }
      const indice = encontrado.index;
      const fin = indice + bruto.length;
      const perdonado =
        estaNegado(plano, indice) ||
        esSoloAnotacion(plano, fin) ||
        (regla.familia === "estado" &&
          (esCondicional(plano, fin) ||
            describeElProceso(plano, original, indice) ||
            esDeOtro(plano, fin)));
      if (perdonado) continue;
      if (!mejor || indice < mejor.indice) mejor = { indice, largo: bruto.length };
      break; // con la primera aparición válida de esta regla alcanza
    }
  }

  if (!mejor) return { promises: false, match: null };
  return {
    promises: true,
    match: original.slice(mejor.indice, mejor.indice + mejor.largo),
  };
}

/**
 * Un enlace solo se interpola si es `https://` y no trae espacios. La
 * validación de host contra `profile.linkHosts` la hace `safeLink` aguas
 * arriba; esto es el último cinturón para no armar un mensaje con un esquema
 * raro si alguien llama a esta función con un enlace sin validar.
 */
function enlaceUsable(link: string | null | undefined): string | null {
  const limpio = (link ?? "").trim();
  if (!limpio.startsWith("https://")) return null;
  if (/\s/.test(limpio)) return null;
  return limpio;
}

/**
 * La frase segura: dice la verdad del negocio (la reserva se completa en el
 * sitio), deja la puerta abierta y no promete nada. Está escrita para no
 * disparar la propia guarda — hay un test que lo verifica, porque un
 * reemplazo que volviera a matchear sería un bucle silencioso.
 */
export function safeBookingReply(link?: string | null): string {
  const enlace = enlaceUsable(link);
  if (enlace) {
    return (
      "La reserva se completa en el sitio del alojamiento, no por chat. " +
      `Te paso el enlace para que la hagas vos 👉 ${enlace}\n\n` +
      "Si necesitás una mano con las fechas o el precio, decime y lo vemos por acá."
    );
  }
  return (
    "La reserva se completa en el sitio del alojamiento, no por chat. " +
    "Si querés te paso el enlace de la propiedad y la hacés vos; cualquier duda " +
    "con las fechas o el precio, decime y lo vemos por acá."
  );
}

/**
 * Lo que usa el pipeline antes de enviar: si el texto promete una reserva, lo
 * reemplaza ENTERO por la frase segura (no se intenta editar la frase
 * infractora: un texto que ya prometió no se arregla recortándolo). Devuelve
 * `replaced` y `match` para que quien llama registre y cuente el incidente.
 */
export function stripBookingPromise(
  text: string | null | undefined,
  options?: { link?: string | null }
): GuardedReply {
  const original = text ?? "";
  const deteccion = detectBookingPromise(original);
  if (!deteccion.promises) {
    return { text: original, replaced: false, match: null };
  }
  return {
    text: safeBookingReply(options?.link ?? null),
    replaced: true,
    match: deteccion.match,
  };
}
