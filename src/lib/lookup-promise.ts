/**
 * Promesas vacías (031): ¿el texto anuncia una consulta que el agente va a
 * hacer DESPUÉS? En este sistema no hay después: el agente solo vuelve a
 * hablar cuando el cliente escribe. «Busco opciones para 10 personas…» sin
 * haber buscado deja al cliente esperando para siempre (caso Agustina,
 * 6-oct-2026).
 *
 * PURA y conservadora: mira oración por oración y descarta preguntas y
 * ofrecimientos («si querés, busco otras fechas»), y cualquier texto con un
 * enlace (ese ya trae el resultado).
 */

const ANNOUNCE: RegExp[] = [
  /\b(busco|buscando|voy a buscar|consulto|consultando|voy a consultar|reviso|revisando|voy a revisar|chequeo|chequeando|voy a chequear|verifico|verificando|voy a verificar|me fijo|fij[aá]ndome|me voy a fijar)\b/i,
  /\bd[eé]j[aá]me (ver|consultar|revisar|chequear|buscar|fijarme|verificar|confirmar)\b/i,
  /\b(ya|ahora|enseguida) te (confirmo|paso|aviso|digo|escribo|cuento)\b/i,
  /\ben (un|unos) (rato|ratito|momento|momentito|minuto|minutos|segundo|segundos)\b/i,
  /\b(aguard[aá]me|esper[aá]me|dame) un (momento|minuto|segundo|ratito)\b/i,
];

/** Ofrecimientos y condicionales: no son promesas. */
const OFFER = /\b(si|puedo|podemos|podr[ií]a|quer[eé]s|quieres|quieren|gustar[ií]a|prefer[ií]s)\b/i;

export function announcesLookup(text: string | null | undefined): boolean {
  if (!text) return false;
  if (/https?:\/\//i.test(text)) return false;
  const sentences = text.split(/(?<=[.!?\n])/);
  return sentences.some((raw) => {
    const s = raw.trim();
    if (!s || s.endsWith("?") || s.startsWith("¿")) return false;
    if (OFFER.test(s)) return false;
    return ANNOUNCE.some((r) => r.test(s));
  });
}
