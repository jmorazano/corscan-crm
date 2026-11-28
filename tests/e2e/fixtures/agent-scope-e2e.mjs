// E2E del modo de prueba del agente («solo en las que yo prenda»).
// Uso: con el dev server en :3000 y los mocks prendidos,
//   node tests/e2e/fixtures/agent-scope-e2e.mjs
// Deja la empresa como estaba (perfil y conversaciones apagadas).
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { login, check, done, sleep, BASE } from "./attention-lib.mjs";

const ORG = "org_m9651yzzrnaw62lwo4lm";
const PN = "111111111";
const url = readFileSync(process.cwd() + "/.env", "utf8").match(/^DATABASE_URL=(.*)$/m)[1];
const sql = postgres(url, { onnotice: () => {} });
const stamp = Date.now().toString().slice(-6);
const phone = (n) => `54935177${stamp}${n}`;

async function inbound(from, text) {
  const r = await fetch(`${BASE}/api/dev/wa-mock/inbound`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumberId: PN, from, name: `Prueba ${from.slice(-2)}`, text }),
  });
  if (!r.ok) throw new Error(`inbound ${r.status} ${await r.text()}`);
}
async function until(fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(400);
  }
  return null;
}
async function convOf(from) {
  const [row] = await sql`
    select cv.id, cv.ai_enabled from conversation cv join contact ct on ct.id = cv.contact_id
    where cv.organization_id = ${ORG} and ct.phone = ${from} and not cv.is_test`;
  return row ?? null;
}
const outCount = async (cv) =>
  Number((await sql`select count(*)::int n from message where conversation_id = ${cv} and direction = 'out'`)[0].n);

const [prevProfile] = await sql`select enabled, agent_scope, reply_delay_ms, shared_personal_number from agent_profile where organization_id = ${ORG}`;
const prevOff = (await sql`select id from conversation where organization_id = ${ORG} and not is_test and not ai_enabled`).map((r) => r.id);
// El socio entra como MIEMBRO de esta empresa (se quita al final si lo sumó el guion).
const [socioUser] = await sql`select id from "user" where email = 'socio@vocero.test'`;
const addedMember = await sql`insert into member (id, organization_id, user_id, role, created_at)
  values ('mem_scope_e2e_socio', ${ORG}, ${socioUser.id}, 'member', now()) on conflict do nothing returning id`;
await sql`update agent_profile set reply_delay_ms = 0, shared_personal_number = false, enabled = false, agent_scope = 'all' where organization_id = ${ORG}`;

try {
  const owner = await login("e2e@vocero.test", "E2eVocero2026!");
  await owner.api("/api/workspaces/switch", { method: "POST", body: { organizationId: ORG } });
  const socio = await login("socio@vocero.test", "Vocero2026!");
  const sw = await socio.api("/api/workspaces/switch", { method: "POST", body: { organizationId: ORG } });
  // Sin esto, el PUT del socio cambiaría SU empresa: se corta acá.
  if (sw.status !== 200) throw new Error(`el socio no pudo entrar a la empresa: ${sw.status} ${sw.text}`);

  console.log("\n[1. estado inicial]");
  let s = await owner.api("/api/agent/scope");
  check("GET: modo todas", s.status === 200 && s.json.summary.scope === "all", s.json);
  const total = s.json.summary.total;
  check("conteo de conversaciones reales", total > 0 && s.json.summary.aiOff === prevOff.length, s.json.summary);

  console.log("\n[2. permisos y validación]");
  const m = await socio.api("/api/agent/scope", { method: "PUT", body: { scope: "selected" } });
  check("miembro no cambia el modo (403)", m.status === 403, m.status);
  const bad = await owner.api("/api/agent/scope", { method: "PUT", body: { scope: "all" } });
  check("«todas» sin decir qué pasa con las apagadas → 400/422", bad.status === 400 || bad.status === 422, bad.status);

  console.log("\n[3. prender el agente en modo de prueba]");
  s = await owner.api("/api/agent/scope", { method: "PUT", body: { scope: "selected", enableAgent: true } });
  check("PUT selected + enableAgent", s.status === 200 && s.json.summary.scope === "selected", s.json);
  check("todas las conversaciones quedan apagadas", s.json.summary.aiOn === 0 && s.json.summary.aiOff === total, s.json.summary);
  check("apagó las que estaban prendidas", s.json.changed === total - prevOff.length, s.json.changed);
  const [p] = await sql`select enabled from agent_profile where organization_id = ${ORG}`;
  check("el agente de la empresa quedó prendido", p.enabled === true);

  console.log("\n[4. una conversación NUEVA nace apagada y el agente no responde]");
  const a = phone(1);
  await inbound(a, "Hola, quiero info de un departamento");
  const cvA = await until(() => convOf(a));
  check("conversación creada", !!cvA);
  check("nace con la IA apagada", cvA && cvA.ai_enabled === false, cvA);
  const silent = await until(async () => {
    const [e] = await sql`select reason from conversation_event where conversation_id = ${cvA.id} and kind = 'ai_silent' limit 1`;
    return e ?? null;
  }, 15000);
  check("el turno calló por IA pausada", silent?.reason === "paused", silent);
  check("no salió ningún mensaje", (await outCount(cvA.id)) === 0);

  console.log("\n[5. prenderla a mano → el agente responde]");
  const patch = await socio.api(`/api/conversations/${cvA.id}`, { method: "PATCH", body: { aiEnabled: true } });
  check("el miembro prende la IA del chat", patch.status === 200, patch.status);
  await inbound(a, "¿Siguen disponibles?");
  const replied = await until(async () => (await outCount(cvA.id)) > 0, 20000);
  check("el agente respondió en el chat prendido", !!replied);

  console.log("\n[6. filtro «IA prendida» en la Bandeja]");
  const list = await owner.api("/api/conversations?filter=ai_on&limit=50");
  check("agentScope = selected", list.json?.agentScope === "selected", list.json?.agentScope);
  check("solo la conversación prendida", list.json?.conversations.length === 1 && list.json.conversations[0].id === cvA.id, list.json?.conversations.map((c) => c.id));
  check("aiOnTotal = 1", list.json?.aiOnTotal === 1, list.json?.aiOnTotal);
  check("el Entrenador no aparece en el filtro", list.json?.trainer === null, list.json?.trainer?.id);

  console.log("\n[7. repetir el modo de prueba NO apaga lo que el equipo prendió]");
  s = await owner.api("/api/agent/scope", { method: "PUT", body: { scope: "selected", enableAgent: true } });
  check("sin cambios", s.json.changed === 0 && s.json.summary.aiOn === 1, s.json);

  console.log("\n[8. responder en todas, sin prender las apagadas]");
  s = await owner.api("/api/agent/scope", { method: "PUT", body: { scope: "all", enableExisting: false } });
  check("modo todas, las existentes como estaban", s.json.summary.scope === "all" && s.json.summary.aiOn === 1 && s.json.changed === 0, s.json);
  const b = phone(2);
  await inbound(b, "Hola, consulta por alquiler");
  const cvB = await until(() => convOf(b));
  check("la nueva nace prendida", cvB && cvB.ai_enabled === true, cvB);
  const repliedB = await until(async () => (await outCount(cvB.id)) > 0, 20000);
  check("y el agente le responde", !!repliedB);

  console.log("\n[9. responder en todas, prendiendo las apagadas]");
  await owner.api("/api/agent/scope", { method: "PUT", body: { scope: "selected" } });
  s = await owner.api("/api/agent/scope", { method: "PUT", body: { scope: "all", enableExisting: true } });
  check("todas prendidas", s.json.summary.aiOff === 0, s.json.summary);
} finally {
  await sql`update agent_profile set enabled = ${prevProfile.enabled}, agent_scope = ${prevProfile.agent_scope},
    reply_delay_ms = ${prevProfile.reply_delay_ms}, shared_personal_number = ${prevProfile.shared_personal_number}
    where organization_id = ${ORG}`;
  await sql`update conversation set ai_enabled = true where organization_id = ${ORG} and not is_test`;
  if (prevOff.length) await sql`update conversation set ai_enabled = false where id in ${sql(prevOff)}`;
  if (addedMember.length) await sql`delete from member where id = 'mem_scope_e2e_socio'`;
  await sql.end();
  done();
}
