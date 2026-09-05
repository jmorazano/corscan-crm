import { eq, inArray } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import { schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * Negocio de demostración "Clima Córdoba" (FR-075): instalación y service de
 * aire acondicionado, un rubro que en Argentina se vende casi entero por
 * WhatsApp. Idempotente: borra los datos demo previos de la organización
 * (scoped por los teléfonos demo) y reinserta. El KB queda lleno EXCEPTO
 * garantía de los trabajos — hueco INTENCIONAL para que el Laboratorio
 * encuentre algo real en la primera corrida.
 */

type Db = ReturnType<typeof getDb>;

const HOURS = 60 * 60 * 1000;

const DEMO_CONTACTS: {
  phone: string;
  name: string;
  notes?: string;
  stage: string;
  thread: { dir: "in" | "out"; text: string; hoursAgo: number; ai?: boolean }[];
}[] = [
  {
    phone: "5493512340001",
    name: "María Fernanda López",
    stage: "Interesado",
    notes: "Reforma el departamento; quiere split para el living.",
    thread: [
      { dir: "in", text: "Hola, ¿instalan aires acondicionados?", hoursAgo: 5 },
      { dir: "out", text: "¡Hola María! Sí, instalamos y hacemos service. Para un ambiente de living, el split 3500 frigorías instalado sale $985.000 y el de 4500 $1.240.000, equipo y mano de obra incluidos.", hoursAgo: 5, ai: true },
      { dir: "in", text: "¿La instalación incluye la caños y el soporte?", hoursAgo: 4 },
      { dir: "out", text: "Sí: incluye hasta 3 metros de cañería, soporte, vacío con bomba y puesta en marcha. Si hace falta más recorrido, el metro adicional sale $38.000.", hoursAgo: 4, ai: true },
      { dir: "in", text: "Perfecto, me interesa el de 3500. ¿Me lo reservan?", hoursAgo: 3 },
    ],
  },
  {
    phone: "5493512340002",
    name: "Carlos Ramírez",
    stage: "En conversación",
    thread: [
      { dir: "in", text: "Buenas, ¿cuánto sale la limpieza de un split?", hoursAgo: 8 },
      { dir: "out", text: "¡Hola Carlos! La limpieza profunda con desinfección sale $62.000 por equipo. Si son 3 o más, queda $54.000 cada uno.", hoursAgo: 8, ai: true },
      { dir: "in", text: "Tengo 4 equipos, ¿van hasta Villa Allende?", hoursAgo: 7 },
      { dir: "out", text: "Sí, cubrimos Sierras Chicas. El viático a Villa Allende es $25.000. Total: 4 × $54.000 + $25.000 = $241.000. ¿Te agendo esta semana?", hoursAgo: 7, ai: true },
    ],
  },
  {
    phone: "5493512340003",
    name: "Lucía Fernández",
    stage: "Cliente",
    notes: "Service recurrente de los equipos de su consultorio.",
    thread: [
      { dir: "in", text: "Hola de nuevo, se largó a gotear el del consultorio 😅", hoursAgo: 30 },
      { dir: "out", text: "¡Hola Lucía! Suele ser el drenaje tapado. Te agendamos la visita técnica: $48.000, y si hay que destapar y limpiar queda todo incluido. ¿Mañana a la mañana te sirve?", hoursAgo: 30, ai: true },
      { dir: "in", text: "Sí dale, mañana temprano mejor", hoursAgo: 29 },
      { dir: "out", text: "Listo, te agendamos 9:30. ¡Gracias Lucía!", hoursAgo: 29, ai: true },
    ],
  },
  {
    phone: "5493512340004",
    name: "Jorge Castillo",
    stage: "Nuevo",
    thread: [
      { dir: "in", text: "buenas tienen aires de 3000 frigorias inverter?", hoursAgo: 2 },
      { dir: "out", text: "¡Hola Jorge! Sí: el 3000 frigorías inverter frío/calor está en $890.000 instalado. ¿Es para un dormitorio o para living?", hoursAgo: 2, ai: true },
    ],
  },
  {
    phone: "5493512340005",
    name: "Ana Sofía Torres",
    stage: "Interesado",
    thread: [
      { dir: "in", text: "Hola, vi el anuncio. ¿Hacen instalaciones para oficinas?", hoursAgo: 12 },
      { dir: "out", text: "¡Hola Ana! Sí, trabajamos con oficinas y locales. ¿Cuántos ambientes son y qué superficie tienen?", hoursAgo: 12, ai: true },
      { dir: "in", text: "Son 3 oficinas de unos 20 m² cada una", hoursAgo: 11 },
      { dir: "out", text: "Te paso el presupuesto: 3 splits de 3000 frigorías inverter instalados, $890.000 cada uno = $2.670.000. Por ser 3 equipos te hacemos 10% off: $2.403.000. ¿Coordinamos una visita para medir?", hoursAgo: 11, ai: true },
      { dir: "in", text: "Dejame confirmar con el arquitecto y te aviso", hoursAgo: 10 },
    ],
  },
  {
    phone: "5493512340006",
    name: "Roberto Mendoza",
    stage: "Perdido",
    notes: "Buscaba un precio que no podemos igualar.",
    thread: [
      { dir: "in", text: "¿Cuánto la instalación sola? El equipo ya lo tengo", hoursAgo: 96 },
      { dir: "out", text: "Hola Roberto: la instalación sola de un split hasta 4500 frigorías sale $340.000, con materiales incluidos. ¿Para cuándo lo necesitás?", hoursAgo: 96, ai: true },
      { dir: "in", text: "Uh no, me lo hacen por 200 acá a la vuelta", hoursAgo: 95 },
      { dir: "out", text: "Te entiendo. A ese precio no llegamos, pero si el trabajo no queda bien acá estamos, con garantía por escrito. ¡Éxitos!", hoursAgo: 95, ai: true },
    ],
  },
  {
    phone: "5493512340007",
    name: "Paty Domínguez",
    stage: "En conversación",
    thread: [
      { dir: "in", text: "Hola, el aire no enfría nada y hace un ruido raro 😩", hoursAgo: 26 },
      { dir: "out", text: "¡Hola Paty! Puede ser falta de gas o el ventilador. La visita técnica con diagnóstico sale $48.000 y se descuenta si hacés la reparación con nosotros. ¿Qué modelo es y hace cuánto lo tenés?", hoursAgo: 26, ai: true },
      { dir: "in", text: "Es un Surrey de unos 6 años, ¿le hará falta carga de gas?", hoursAgo: 25 },
    ],
  },
  {
    phone: "5493512340008",
    name: "Héctor Aguilar",
    stage: "Cliente",
    thread: [
      { dir: "in", text: "Che, mandame el presupuesto del service de siempre para el galpón", hoursAgo: 50 },
      { dir: "out", text: "¡Cómo no, Héctor! El service semestral de los 4 equipos del galpón: limpieza, control de gas y ajuste de consumos. Total: $216.000. ¿Lo agendamos para el jueves en Alta Gracia?", hoursAgo: 50, ai: true },
      { dir: "in", text: "Dale, el jueves está bien. Factura A como siempre", hoursAgo: 49 },
      { dir: "out", text: "Perfecto, jueves a la mañana y factura A. ¡Gracias Héctor!", hoursAgo: 49, ai: true },
    ],
  },
];

const DEMO_KB: { kind: "qa" | "block"; question?: string; answer?: string; content?: string }[] = [
  {
    kind: "block",
    content:
      "Clima Córdoba — empresa familiar con 15 años instalando y manteniendo equipos de aire acondicionado en Córdoba capital y Sierras Chicas. Hacemos instalación de splits, service y limpieza, carga de gas y reparaciones. Atendemos casas, oficinas, consultorios y locales comerciales.",
  },
  { kind: "qa", question: "¿Cuál es el horario?", answer: "Lunes a viernes de 8:00 a 18:00 y sábados de 9:00 a 13:00." },
  { kind: "qa", question: "¿Dónde están ubicados?", answer: "Av. Colón 1450, barrio Alberdi, Córdoba capital. Atendemos a domicilio en toda la ciudad." },
  { kind: "qa", question: "¿Hasta dónde llegan?", answer: "Córdoba capital sin cargo. Sierras Chicas (Villa Allende, Río Ceballos, Unquillo) con viático de $25.000, y Alta Gracia con viático de $30.000." },
  { kind: "qa", question: "¿Qué formas de pago aceptan?", answer: "Efectivo, transferencia bancaria y tarjeta de crédito en 3 o 6 cuotas. En instalaciones se pide una seña del 50% para reservar el equipo." },
  { kind: "qa", question: "¿Hacen factura?", answer: "Sí, somos Responsables Inscriptos. Emitimos factura A o B; para factura A necesitamos tu CUIT y razón social." },
  { kind: "qa", question: "¿Tienen descuentos por cantidad?", answer: "Sí: a partir de 3 equipos hacemos 10% de descuento en instalación, y en service a partir de 3 equipos el precio por unidad baja." },
  { kind: "qa", question: "¿Con qué marcas trabajan?", answer: "Instalamos Surrey, BGH, Philco, Midea y Samsung. Hacemos service de cualquier marca, incluso equipos que no vendimos nosotros." },
  // HUECO INTENCIONAL: nada sobre la garantía de los trabajos (lo encuentra el Laboratorio).
];

/**
 * Teléfonos de datasets demo anteriores. La limpieza previa busca por número,
 * así que al cambiar el dataset hay que seguir barriendo los viejos: si no, un
 * re-seed deja los contactos de la versión anterior conviviendo con los nuevos
 * (regla IV: seeds re-ejecutables). Nunca borrar esta lista, solo agregarle.
 */
const LEGACY_DEMO_PHONES = [
  // Dataset mexicano "Ferretería El Martillo", reemplazado por "Clima Córdoba".
  "5215612340001",
  "5215612340002",
  "5215612340003",
  "5215612340004",
  "5215612340005",
  "5215612340006",
  "5215612340007",
  "5215612340008",
];

export async function seedDemo(
  db: Db,
  organizationId: string
): Promise<{ contacts: number; kbEntries: number }> {
  const demoPhones = [
    ...DEMO_CONTACTS.map((c) => c.phone),
    ...LEGACY_DEMO_PHONES,
  ];

  // --- Idempotencia: limpiar datos demo previos (orden inverso de FKs) ---
  // Scoped por organización (FR-005): otra empresa puede tener contactos
  // reales con estos mismos números — jamás se barren cross-tenant.
  const prevContacts = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        inArray(schema.contact.phone, demoPhones)
      )
    );
  const prevIds = prevContacts.map((c) => c.id);
  if (prevIds.length > 0) {
    const prevConvs = await db
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(inArray(schema.conversation.contactId, prevIds));
    const convIds = prevConvs.map((c) => c.id);
    if (convIds.length > 0) {
      await db
        .delete(schema.message)
        .where(inArray(schema.message.conversationId, convIds));
      await db
        .delete(schema.conversation)
        .where(inArray(schema.conversation.id, convIds));
    }
    await db.delete(schema.lead).where(inArray(schema.lead.contactId, prevIds));
    await db.delete(schema.contact).where(inArray(schema.contact.id, prevIds));
  }
  // KB y corridas demo previas
  await db
    .delete(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId));
  await db
    .delete(schema.agentTestCase)
    .where(eq(schema.agentTestCase.organizationId, organizationId));
  await db
    .delete(schema.agentTestRun)
    .where(eq(schema.agentTestRun.organizationId, organizationId));

  // --- Etapas (por nombre) ---
  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId));
  const stageByName = new Map(stages.map((s) => [s.name, s.id]));
  const fallbackStage = stages[0]?.id;
  if (!fallbackStage) throw new Error("La organización no tiene etapas");

  // --- Contactos + conversaciones + mensajes + leads ---
  const now = Date.now();
  let position = 0;
  for (const demo of DEMO_CONTACTS) {
    const contactId = newId("contact");
    await db.insert(schema.contact).values({
      id: contactId,
      organizationId,
      phone: demo.phone,
      name: demo.name,
      notes: demo.notes ?? null,
    });

    const lastInbound = demo.thread
      .filter((t) => t.dir === "in")
      .reduce((min, t) => Math.min(min, t.hoursAgo), Infinity);
    const lastMessage = demo.thread.reduce(
      (min, t) => Math.min(min, t.hoursAgo),
      Infinity
    );

    const conversationId = newId("conversation");
    await db.insert(schema.conversation).values({
      id: conversationId,
      organizationId,
      contactId,
      lastInboundAt: new Date(now - lastInbound * HOURS),
      lastMessageAt: new Date(now - lastMessage * HOURS),
      unreadCount: demo.thread[demo.thread.length - 1]?.dir === "in" ? 1 : 0,
    });

    for (const msg of demo.thread) {
      const at = new Date(now - msg.hoursAgo * HOURS);
      await db.insert(schema.message).values({
        id: newId("message"),
        organizationId,
        conversationId,
        waMessageId: `wamid.demo.${newId("message")}`,
        direction: msg.dir,
        type: "text",
        text: msg.text,
        status: msg.dir === "in" ? "delivered" : "read",
        aiGenerated: msg.ai ?? false,
        waTimestamp: at,
        createdAt: at,
      });
    }

    await db.insert(schema.lead).values({
      id: newId("lead"),
      organizationId,
      contactId,
      stageId: stageByName.get(demo.stage) ?? fallbackStage,
      position: position++,
      lastActivityAt: new Date(now - lastMessage * HOURS),
    });
  }

  // --- Knowledge base (con el hueco intencional) ---
  for (const entry of DEMO_KB) {
    await db.insert(schema.kbEntry).values({
      id: newId("kbEntry"),
      organizationId,
      kind: entry.kind,
      question: entry.question ?? null,
      answer: entry.answer ?? null,
      content: entry.content ?? null,
    });
  }

  // --- Comportamiento del agente de la demo ---
  await db
    .update(schema.agentProfile)
    .set({
      name: "Clari",
      tone: "Cercana y resolutiva, de empresa de barrio que cumple. Trata de vos al cliente (voseo rioplatense).",
      instructions:
        "Ayudá a presupuestar y a cerrar la visita o la instalación. Dá precios en pesos argentinos solo si están en el conocimiento. Si preguntan por descuentos, mencioná los mínimos por cantidad. Nunca inventes disponibilidad de equipos ni plazos de entrega.",
      escalationRules:
        "Escalá a una persona si el equipo está en garantía y hay un reclamo, si piden factura A con datos fiscales que no tenés, o si lo piden explícitamente.",
      greeting: "¡Hola! Soy Clari, la asistente de Clima Córdoba ❄️",
      updatedAt: new Date(),
    })
    .where(eq(schema.agentProfile.organizationId, organizationId));

  // --- Corrida de Laboratorio de ejemplo (guardada, con el hueco encontrado) ---
  const runId = newId("testRun");
  await db.insert(schema.agentTestRun).values({
    id: runId,
    organizationId,
    status: "done",
    score: 83,
    startedAt: new Date(now - 24 * HOURS),
    finishedAt: new Date(now - 24 * HOURS + 3 * 60 * 1000),
  });
  const exampleCases: {
    persona: string;
    veredicto: "verde" | "amarillo" | "rojo";
    hallazgos: unknown[];
    transcript: { role: string; text: string }[];
  }[] = [
    {
      persona: "comprador_decidido",
      veredicto: "verde",
      hallazgos: [],
      transcript: [
        { role: "cliente", text: "¿Tienen splits de 3000 frigorías inverter?" },
        { role: "agente", text: "¡Sí! El 3000 frigorías inverter frío/calor está en $890.000 instalado." },
        { role: "cliente", text: "Me convence, lo quiero. ¿Cómo pago?" },
        { role: "agente", text: "Efectivo, transferencia o tarjeta en 3 o 6 cuotas. Con el 50% de seña te reservo el equipo." },
      ],
    },
    {
      persona: "pregunton_precios",
      veredicto: "verde",
      hallazgos: [],
      transcript: [
        { role: "cliente", text: "¿Cuánto sale un aire?" },
        { role: "agente", text: "Depende de la superficie del ambiente. ¿Cuántos metros tiene? Así te paso el precio del equipo que corresponde." },
      ],
    },
    {
      persona: "cliente_enojado",
      veredicto: "amarillo",
      hallazgos: [
        {
          tipo: "tono",
          evidencia:
            "El agente respondió correcto pero algo frío ante 'un desastre'; faltó empatizar antes de escalar.",
        },
      ],
      transcript: [
        { role: "cliente", text: "Me instalaron el aire la semana pasada y ya está goteando adentro, un desastre" },
        { role: "agente", text: "Lamento el inconveniente. Paso tu caso a un compañero del equipo para resolverlo." },
      ],
    },
    {
      persona: "fuera_de_kb",
      veredicto: "rojo",
      hallazgos: [
        {
          tipo: "fuera_de_kb",
          evidencia:
            "El cliente preguntó por la garantía de los trabajos y el conocimiento no lo cubre.",
          sugerencia: {
            pregunta: "¿Qué garantía tienen los trabajos?",
            respuesta:
              "La instalación tiene 12 meses de garantía sobre la mano de obra; el equipo mantiene la garantía oficial del fabricante.",
          },
        },
      ],
      transcript: [
        { role: "cliente", text: "¿Qué garantía me dan por la instalación?" },
        { role: "agente", text: "Dejame confirmarlo con el equipo y te aviso en un momento." },
      ],
    },
    {
      persona: "pide_humano",
      veredicto: "verde",
      hallazgos: [],
      transcript: [
        { role: "cliente", text: "Prefiero que me atienda una persona, quiero hablar con alguien del equipo" },
        { role: "agente", text: "(handoff: la conversación pasó a atención humana)" },
      ],
    },
    {
      persona: "errores_modismos",
      veredicto: "verde",
      hallazgos: [],
      transcript: [
        { role: "cliente", text: "ola asen servis de aires?" },
        { role: "agente", text: "¡Claro que sí! Hacemos service de cualquier marca. ¿Qué equipo tenés y qué le pasa?" },
      ],
    },
  ];
  for (const c of exampleCases) {
    await db.insert(schema.agentTestCase).values({
      id: newId("testCase"),
      organizationId,
      runId,
      persona: c.persona,
      status: "done",
      veredicto: c.veredicto,
      hallazgos: c.hallazgos,
      transcript: c.transcript,
    });
  }

  return { contacts: DEMO_CONTACTS.length, kbEntries: DEMO_KB.length };
}

/** true si la organización aún no tiene datos de dominio (para el botón). */
export async function isDomainEmpty(
  db: Db,
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(eq(schema.contact.organizationId, organizationId))
    .limit(1);
  return rows.length === 0;
}
