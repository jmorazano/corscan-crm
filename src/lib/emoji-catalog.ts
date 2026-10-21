/**
 * Catálogo de emojis del selector del composer (038). PURO: sin I/O, sin
 * dependencias. Un catálogo propio y acotado en vez de una librería: los
 * emojis que se usan para atender clientes entran en unos cientos, la
 * búsqueda va en español y no hay que bajar datos de ningún CDN
 * (constitución II).
 *
 * Cada entrada es `[emoji, palabras clave]`; las palabras van sin tildes y
 * en minúscula (la búsqueda normaliza lo que escribe el operador igual).
 */

export type EmojiEntry = readonly [emoji: string, keywords: string];

export type EmojiCategory = {
  id: string;
  label: string;
  /** Emoji que representa la pestaña. */
  icon: string;
  emojis: readonly EmojiEntry[];
};

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  {
    id: "caras",
    label: "Caras",
    icon: "😀",
    emojis: [
      ["😀", "sonrisa feliz contento cara"],
      ["😃", "sonrisa feliz alegre"],
      ["😄", "sonrisa feliz risa"],
      ["😁", "sonrisa dientes feliz"],
      ["😆", "risa carcajada"],
      ["😅", "risa nervios sudor uf"],
      ["🤣", "risa carcajada piso jaja"],
      ["😂", "risa lagrimas jaja gracioso"],
      ["🙂", "sonrisa leve bien"],
      ["🙃", "al reves ironia"],
      ["😉", "guino complice"],
      ["😊", "sonrisa sonrojado amable feliz"],
      ["😇", "angel bueno inocente"],
      ["🥰", "amor enamorado corazones"],
      ["😍", "amor enamorado ojos corazon encanta"],
      ["🤩", "estrellas genial wow"],
      ["😘", "beso"],
      ["😋", "rico delicioso sabroso"],
      ["😜", "guino lengua broma"],
      ["🤪", "loco divertido"],
      ["🤗", "abrazo"],
      ["🤭", "uy risita tapando boca"],
      ["🤫", "silencio secreto shh"],
      ["🤔", "pensando duda hmm"],
      ["🤐", "callado cierre boca"],
      ["😐", "neutral serio"],
      ["😑", "sin expresion"],
      ["😶", "sin palabras"],
      ["😏", "picaro sonrisa ladeada"],
      ["🙄", "ojos en blanco fastidio"],
      ["😬", "mueca incomodo uy"],
      ["😌", "aliviado tranquilo"],
      ["😔", "pensativo triste"],
      ["😪", "sueno cansado"],
      ["😴", "dormido sueno zzz"],
      ["😷", "barbijo enfermo"],
      ["🤒", "fiebre enfermo"],
      ["🥵", "calor"],
      ["🥶", "frio helado"],
      ["😵", "mareado"],
      ["🤯", "cabeza explota sorpresa"],
      ["🥳", "fiesta festejo cumpleanos"],
      ["😎", "lentes canchero genial"],
      ["🤓", "nerd estudioso"],
      ["🧐", "monoculo analizando"],
      ["😕", "confundido"],
      ["😟", "preocupado"],
      ["🙁", "triste leve"],
      ["😮", "sorpresa boca abierta"],
      ["😲", "asombro sorpresa"],
      ["😳", "sonrojado verguenza"],
      ["🥺", "por favor ojitos suplica"],
      ["😢", "llorar triste lagrima"],
      ["😭", "llanto llorar mucho"],
      ["😱", "miedo grito susto"],
      ["😩", "agotado cansado"],
      ["😤", "enojo resoplido"],
      ["😡", "enojado furioso"],
      ["🤬", "insultos furioso"],
      ["🥲", "sonrisa con lagrima emocion"],
      ["🫠", "derritiendo"],
      ["🫡", "saludo militar a la orden"],
    ],
  },
  {
    id: "gestos",
    label: "Gestos",
    icon: "👍",
    emojis: [
      ["👍", "pulgar arriba ok bien si de acuerdo like"],
      ["👎", "pulgar abajo mal no"],
      ["👌", "ok perfecto"],
      ["✌️", "paz victoria dos"],
      ["🤞", "dedos cruzados suerte"],
      ["🤟", "te quiero"],
      ["🤘", "rock"],
      ["🤙", "llamame telefono"],
      ["👋", "hola chau saludo mano"],
      ["🤚", "mano alto"],
      ["✋", "mano alto pare"],
      ["🖐️", "mano cinco"],
      ["👏", "aplausos bravo felicitaciones"],
      ["🙌", "festejo celebrar manos arriba"],
      ["👐", "manos abiertas"],
      ["🤲", "palmas"],
      ["🙏", "gracias por favor rezar"],
      ["🤝", "acuerdo trato apreton manos"],
      ["💪", "fuerza musculo vamos"],
      ["👉", "senalar derecha"],
      ["👈", "senalar izquierda"],
      ["👆", "senalar arriba"],
      ["👇", "senalar abajo"],
      ["☝️", "un momento uno"],
      ["✍️", "escribir firmar"],
      ["🫶", "corazon manos amor"],
      ["👀", "ojos mirando ver"],
      ["🧠", "cerebro idea"],
    ],
  },
  {
    id: "corazones",
    label: "Corazones",
    icon: "❤️",
    emojis: [
      ["❤️", "corazon rojo amor"],
      ["🧡", "corazon naranja"],
      ["💛", "corazon amarillo"],
      ["💚", "corazon verde"],
      ["💙", "corazon azul"],
      ["💜", "corazon violeta"],
      ["🖤", "corazon negro"],
      ["🤍", "corazon blanco"],
      ["🤎", "corazon marron"],
      ["💔", "corazon roto"],
      ["❣️", "corazon exclamacion"],
      ["💕", "dos corazones"],
      ["💞", "corazones girando"],
      ["💓", "corazon latiendo"],
      ["💗", "corazon creciendo"],
      ["💖", "corazon brillante"],
      ["💘", "corazon flecha"],
      ["💝", "corazon regalo"],
      ["💯", "cien perfecto"],
      ["💋", "beso labios"],
    ],
  },
  {
    id: "celebrar",
    label: "Celebrar",
    icon: "🎉",
    emojis: [
      ["🎉", "fiesta festejo felicitaciones"],
      ["🎊", "confeti festejo"],
      ["🥂", "brindis"],
      ["🍾", "champagne festejo"],
      ["🎂", "torta cumpleanos"],
      ["🎁", "regalo"],
      ["🎈", "globo"],
      ["✨", "brillo destellos"],
      ["⭐", "estrella"],
      ["🌟", "estrella brillante"],
      ["🔥", "fuego genial"],
      ["🏆", "trofeo ganador"],
      ["🥇", "medalla oro primero"],
      ["🎯", "objetivo diana"],
      ["🚀", "cohete lanzamiento rapido"],
      ["🌈", "arcoiris"],
      ["☀️", "sol"],
      ["🌙", "luna noche"],
      ["🌸", "flor"],
      ["🌹", "rosa flor"],
      ["🌻", "girasol"],
      ["🍀", "trebol suerte"],
    ],
  },
  {
    id: "negocio",
    label: "Negocio",
    icon: "💼",
    emojis: [
      ["✅", "listo hecho ok tilde"],
      ["☑️", "tilde casilla"],
      ["✔️", "tilde"],
      ["❌", "no cruz error"],
      ["⚠️", "atencion cuidado"],
      ["❗", "importante exclamacion"],
      ["❓", "pregunta"],
      ["ℹ️", "informacion"],
      ["📌", "fijado importante"],
      ["📍", "ubicacion lugar direccion"],
      ["🗺️", "mapa"],
      ["📅", "calendario fecha"],
      ["🗓️", "calendario agenda"],
      ["⏰", "alarma hora"],
      ["⏳", "espera reloj arena"],
      ["🕐", "hora reloj"],
      ["📞", "telefono llamada"],
      ["📱", "celular"],
      ["💬", "mensaje chat"],
      ["📧", "email correo"],
      ["📩", "correo mensaje"],
      ["📝", "nota escribir formulario"],
      ["📄", "documento hoja"],
      ["📎", "clip adjunto"],
      ["📷", "camara foto"],
      ["🎥", "video camara"],
      ["💼", "trabajo maletin"],
      ["🏢", "oficina empresa edificio"],
      ["🏠", "casa hogar"],
      ["🏡", "casa jardin"],
      ["🛏️", "cama habitacion"],
      ["🔑", "llave"],
      ["🚗", "auto"],
      ["🚚", "camion envio entrega"],
      ["📦", "paquete envio"],
      ["🛒", "carrito compra"],
      ["🛍️", "bolsas compras"],
      ["💰", "dinero bolsa plata"],
      ["💵", "billete dolar plata"],
      ["💳", "tarjeta pago"],
      ["🧾", "recibo factura comprobante"],
      ["📈", "grafico sube crecimiento"],
      ["📊", "grafico barras"],
      ["🔧", "llave herramienta arreglo"],
      ["🛠️", "herramientas"],
      ["⚙️", "engranaje configuracion"],
      ["💡", "idea foco"],
      ["🔒", "candado seguro"],
      ["🎁", "regalo promo"],
      ["🏷️", "etiqueta precio oferta"],
      ["🆕", "nuevo"],
      ["🆓", "gratis"],
      ["🔝", "top"],
      ["➡️", "flecha derecha"],
      ["⬇️", "flecha abajo"],
    ],
  },
  {
    id: "comida",
    label: "Comida",
    icon: "☕",
    emojis: [
      ["☕", "cafe"],
      ["🧉", "mate"],
      ["🍵", "te"],
      ["🍺", "cerveza"],
      ["🍷", "vino"],
      ["🥤", "gaseosa vaso"],
      ["🍕", "pizza"],
      ["🍔", "hamburguesa"],
      ["🌭", "pancho"],
      ["🥩", "carne asado"],
      ["🍖", "carne hueso"],
      ["🥗", "ensalada"],
      ["🍝", "pasta fideos"],
      ["🍣", "sushi"],
      ["🥐", "medialuna croissant"],
      ["🍰", "torta postre"],
      ["🍦", "helado"],
      ["🍫", "chocolate"],
      ["🍎", "manzana"],
      ["🥑", "palta"],
    ],
  },
  {
    id: "naturaleza",
    label: "Naturaleza",
    icon: "🐶",
    emojis: [
      ["🐶", "perro"],
      ["🐱", "gato"],
      ["🐻", "oso"],
      ["🐼", "panda"],
      ["🐨", "koala"],
      ["🦁", "leon"],
      ["🐮", "vaca"],
      ["🐷", "cerdo chancho"],
      ["🐴", "caballo"],
      ["🐔", "gallina"],
      ["🐦", "pajaro"],
      ["🦋", "mariposa"],
      ["🐟", "pez"],
      ["🌳", "arbol"],
      ["🌲", "pino arbol"],
      ["🌵", "cactus"],
      ["🏔️", "montana sierra"],
      ["🏞️", "paisaje parque"],
      ["🏖️", "playa"],
      ["🌊", "ola mar"],
      ["🏊", "pileta nadar"],
      ["🌧️", "lluvia"],
      ["❄️", "nieve frio"],
    ],
  },
];

/** Cuántos recientes se guardan y se muestran. */
export const RECENT_MAX = 24;

/** Minúsculas, sin tildes y sin espacios de sobra (igual que las palabras clave). */
export function foldQuery(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ALL: readonly EmojiEntry[] = (() => {
  const seen = new Set<string>();
  const out: EmojiEntry[] = [];
  for (const c of EMOJI_CATEGORIES) {
    for (const e of c.emojis) {
      if (seen.has(e[0])) continue;
      seen.add(e[0]);
      out.push(e);
    }
  }
  return out;
})();

/**
 * Busca por palabra clave: TODAS las palabras de la consulta tienen que
 * empezar alguna palabra clave («cor roj» → ❤️). Primero los que empiezan
 * con la consulta entera.
 */
export function searchEmojis(query: string, limit = 60): string[] {
  const q = foldQuery(query);
  if (!q) return [];
  const terms = q.split(" ");
  const scored: { emoji: string; score: number; i: number }[] = [];
  ALL.forEach(([emoji, keywords], i) => {
    const words = keywords.split(" ");
    if (!terms.every((t) => words.some((w) => w.startsWith(t)))) return;
    const score = words[0]!.startsWith(terms[0]!) ? 0 : 1;
    scored.push({ emoji, score, i });
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.emoji);
}

/** El emoji usado pasa al frente; sin repetidos y con tope. */
export function pushRecent(recent: readonly string[], emoji: string): string[] {
  return [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_MAX);
}

/** Lo guardado en el navegador puede venir roto o de otra versión: se sanea. */
export function parseRecent(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((e): e is string => typeof e === "string" && e.length > 0 && e.length <= 16)
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/**
 * Inserta el emoji donde está el cursor (o reemplaza la selección) y
 * devuelve el texto nuevo y dónde queda el cursor. Sin cursor conocido, al
 * final.
 */
export function insertAtCursor(
  text: string,
  insert: string,
  selection: { start: number; end: number } | null
): { text: string; caret: number } {
  const start = clamp(selection?.start ?? text.length, 0, text.length);
  const end = clamp(selection?.end ?? start, start, text.length);
  const next = text.slice(0, start) + insert + text.slice(end);
  return { text: next, caret: start + insert.length };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
