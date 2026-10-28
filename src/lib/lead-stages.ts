/**
 * 044: reglas PURAS de las etapas del lead. El pipeline es el embudo de
 * venta: el agente y el sistema solo lo hacen avanzar (salvo «perdido»); las
 * personas del equipo lo mueven como quieran desde el tablero.
 *
 * Las etapas son de cada empresa (se renombran y reordenan), así que se
 * reconocen por ROL: la primera abierta, la abierta que habla de
 * conversación, la de interesados, `won` y `lost`. Sin la etapa del rol, la
 * regla que la usa no hace nada.
 */

export type StageLike = {
  id: string;
  name: string;
  kind: "open" | "won" | "lost";
  position: number;
};

export type StageRole = "first" | "talking" | "interested" | "won" | "lost";

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const TALKING_RE = /convers|charla|contactad|en curso|seguimiento/;
const INTERESTED_RE = /interesad|calificad|negociac|cotiz|propuesta/;

export type StageRoles = Partial<Record<StageRole, StageLike>>;

export function stageRoles<T extends StageLike>(stages: readonly T[]): Partial<Record<StageRole, T>> {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const open = sorted.filter((s) => s.kind === "open");
  const first = open[0];
  const rest = open.slice(1);
  return {
    first,
    talking: rest.find((s) => TALKING_RE.test(fold(s.name))),
    interested: rest.find((s) => INTERESTED_RE.test(fold(s.name))),
    won: sorted.find((s) => s.kind === "won"),
    lost: sorted.find((s) => s.kind === "lost"),
  };
}

/**
 * ¿Puede el agente (o una regla del sistema) llevar el lead de `current` a
 * `target`? Solo hacia adelante entre abiertas; «perdido» solo desde una
 * abierta; «cliente» desde abierta o perdida; de «cliente» no se sale solo;
 * de «perdido» se vuelve a una abierta solo si el contacto no se dio de baja.
 */
export function canAutoMove(
  current: StageLike | null,
  target: StageLike,
  opts: { optedOut?: boolean } = {}
): boolean {
  if (!current) return false;
  if (current.id === target.id) return false;
  if (current.kind === "won") return false;
  if (target.kind === "won") return true;
  if (target.kind === "lost") return current.kind === "open";
  if (current.kind === "lost") return !opts.optedOut;
  return target.position > current.position;
}

const ROLE_MEANING: Record<StageRole, string> = {
  first: "escribió y todavía no hubo charla",
  talking: "respondió y está consultando, sin intención clara de comprar o reservar",
  interested:
    "pidió fechas, precios o disponibilidad concreta: quiere comprar, reservar o contratar",
  won: "compró, reservó o pagó y quedó CONFIRMADO",
  lost: "dijo claramente que no, que no le interesa, que ya consiguió en otro lado o se dio de baja",
};

/**
 * Sección del prompt: la etapa actual y qué significa cada una. El cliente
 * nunca la ve; sirve para que el equipo tenga el pipeline ordenado.
 */
export function renderStageSection(
  stages: readonly StageLike[],
  currentStageId: string | null
): string | null {
  if (stages.length === 0) return null;
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const roles = stageRoles(sorted);
  const roleOf = new Map<string, StageRole>();
  for (const role of Object.keys(roles) as StageRole[]) {
    const st = roles[role];
    if (st && !roleOf.has(st.id)) roleOf.set(st.id, role);
  }
  const current = sorted.find((s) => s.id === currentStageId) ?? null;
  const lines = sorted.map((s) => {
    const role = roleOf.get(s.id);
    return role ? `- «${s.name}»: ${ROLE_MEANING[role]}.` : `- «${s.name}».`;
  });
  return [
    "ETAPA DEL LEAD (ordena el pipeline del equipo; el cliente nunca la ve):",
    current ? `Etapa actual: «${current.name}».` : "Etapa actual: sin lead todavía.",
    "Etapas, en orden:",
    ...lines,
    '- Cuando lo que dijo el cliente muestre que pasó a OTRA etapa, sumá "stage":"<nombre exacto>" a tu acción (reply, update_lead o cualquier consulta). Si no cambió, no lo mandes.',
    "- Las etapas solo avanzan. Perdido solo cuando lo dijo claramente («lo voy a pensar» o dejar de contestar NO es perdido). Cliente solo cuando la compra, la reserva o el pago quedó confirmado, nunca por una intención.",
  ].join("\n");
}
