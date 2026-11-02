import { readFileSync } from "node:fs";
import { createECDH, randomBytes } from "node:crypto";
import postgres from "postgres";
import { login, check, done, sleep, BASE } from "./attention-lib.mjs";

const ORG = "org_m9651yzzrnaw62lwo4lm";
const PN = "111111111";
const MIN = 60_000;
const url = readFileSync(process.cwd() + "/.env", "utf8").match(/^DATABASE_URL=(.*)$/m)[1];
const sql = postgres(url, { onnotice: () => {} });
const stamp = Date.now().toString().slice(-6);
const phone = (n) => `54935199${stamp}${n}`;

const b64u = (b) => Buffer.from(b).toString("base64url");
const key = () => { const e = createECDH("prime256v1"); e.generateKeys(); return b64u(e.getPublicKey()); };

async function inbound(from, text, name = `Cliente ${from.slice(-2)}`) {
  const r = await fetch(`${BASE}/api/dev/wa-mock/inbound`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumberId: PN, from, name, text }),
  });
  if (!r.ok) throw new Error(`inbound ${r.status} ${await r.text()}`);
}
async function convOf(from) {
  const [row] = await sql`select cv.id from conversation cv join contact ct on ct.id = cv.contact_id where cv.organization_id = ${ORG} and ct.phone = ${from}`;
  return row?.id;
}
// Los timestamp de la BD son UTC sin zona: se leen como texto y se marcan Z
// (postgres-js los tomaría como hora local).
const utc = (t) => (t ? new Date(t.replace(" ", "T") + "Z") : null);
async function waitsOf(cv) {
  const rows = await sql`select *, started_at::text s, alerted_at::text a from attention_wait where conversation_id = ${cv} order by started_at`;
  return rows.map((r) => ({ ...r, started_at: utc(r.s), alerted_at: utc(r.a) }));
}
async function until(fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(500); }
  return null;
}
const sweep = async (when) => (await fetch(`${BASE}/api/dev/attention`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ now: when.toISOString() }),
})).json();
// Solo las entregas a dispositivos de PROPIETARIOS (los del miembro, `who=socio`, son los
// avisos de entrantes de 013 y no cuentan acá).
const deliveries = async () =>
  (await (await fetch(`${BASE}/api/dev/push-mock`)).json()).deliveries.filter((d) => !d.query.includes("who=socio")).length;
const socioDeliveries = async () =>
  (await (await fetch(`${BASE}/api/dev/push-mock`)).json()).deliveries.filter((d) => d.query.includes("who=socio")).length;

const [socioUser] = await sql`select id from "user" where email = 'socio@vocero.test'`;
await sql`insert into member (id, organization_id, user_id, role) values ('mem_a48_live_socio', ${ORG}, ${socioUser.id}, 'member') on conflict do nothing`;
const [prevSettings] = await sql`select * from attention_settings where organization_id = ${ORG}`;

try {
  const owner = await login("e2e@vocero.test", "E2eVocero2026!");
  await owner.api("/api/workspaces/switch", { method: "POST", body: { organizationId: ORG } });
  const socio = await login("socio@vocero.test", "Vocero2026!");
  await socio.api("/api/workspaces/switch", { method: "POST", body: { organizationId: ORG } });

  console.log("\n[1. configuración del aviso]");
  // Limpio suscripciones previas del dueño en esta empresa para medir.
  await sql`delete from push_subscription where organization_id = ${ORG}`;
  let g = await owner.api("/api/settings/attention");
  check("GET default apagado 15 min sin push", g.status === 200 && g.json.alertEnabled === false && g.json.alertMinutes === 15 && g.json.ownerHasPush === false, g.json);
  const bad = await owner.api("/api/settings/attention", { method: "PUT", body: { alertEnabled: true, alertMinutes: 4 } });
  check("4 minutos → 422", bad.status === 422, bad.status);
  const memberPut = await socio.api("/api/settings/attention", { method: "PUT", body: { alertEnabled: true, alertMinutes: 15 } });
  check("miembro no puede configurar (403)", memberPut.status === 403, memberPut.status);
  const ownerSub = { endpoint: `${BASE}/api/dev/push-mock?who=owner`, keys: { p256dh: key(), auth: b64u(randomBytes(16)) }, mode: "handoff" };
  check("suscripción del dueño", (await owner.api("/api/push/subscriptions", { method: "POST", body: ownerSub })).status < 300);
  const socioSub = { endpoint: `${BASE}/api/dev/push-mock?who=socio`, keys: { p256dh: key(), auth: b64u(randomBytes(16)) }, mode: "all" };
  check("suscripción del miembro", (await socio.api("/api/push/subscriptions", { method: "POST", body: socioSub })).status < 300);
  g = await owner.api("/api/settings/attention", { method: "PUT", body: { alertEnabled: true, alertMinutes: 15 } });
  check("PUT encendido 15 con push", g.status === 200 && g.json.alertEnabled && g.json.ownerHasPush, g.json);

  console.log("\n[2. derivación sin respuesta → un aviso]");
  const p1 = phone(1);
  await inbound(p1, "Hola, quiero hablar con un humano por favor");
  const cv1 = await until(() => convOf(p1));
  const w1 = await until(async () => (await waitsOf(cv1))[0]);
  check("espera abierta por derivación", w1 && w1.status === "open" && w1.start_reason === "handoff", w1);
  const start1 = new Date(w1.started_at);
  await fetch(`${BASE}/api/dev/push-mock`, { method: "DELETE" });
  let r = await sweep(new Date(start1.getTime() + 14 * MIN));
  let [w] = await waitsOf(cv1);
  check("a los 14 min no avisa", w.alerted_at === null && (await deliveries()) === 0, { r, alerted: w.alerted_at });
  r = await sweep(new Date(start1.getTime() + 15 * MIN));
  [w] = await waitsOf(cv1);
  await sleep(1500);
  const d1 = await deliveries();
  check("a los 15 min avisa (reserva hecha)", w.alerted_at !== null, r);
  check("UNA entrega al dueño", d1 === 1, d1);
  check("ninguna al miembro por el aviso", (await socioDeliveries()) === 0, await socioDeliveries());
  await inbound(p1, "¿Hay alguien?");
  await sleep(3000);
  check("otro mensaje del cliente no abre otra espera", (await waitsOf(cv1)).length === 1);
  const alertedAt = w.alerted_at.getTime();
  const [r2, r3] = await Promise.all([sweep(new Date(start1.getTime() + 20 * MIN)), sweep(new Date(start1.getTime() + 20 * MIN))]);
  const [wAfter] = await waitsOf(cv1);
  // (Los entrantes de una conversación derivada sí le llegan al dueño por 013:
  // por eso acá se mira la reserva y no el contador del push-mock.)
  check("barridos posteriores (en paralelo) no repiten el aviso", r2.alerted === 0 && r3.alerted === 0 && wAfter.alerted_at.getTime() === alertedAt, { r2, r3 });

  console.log("\n[3. respondida por una persona → sin aviso, atribuida]");
  const p2 = phone(2);
  await inbound(p2, "Necesito hablar con un humano");
  const cv2 = await until(() => convOf(p2));
  const w2 = await until(async () => (await waitsOf(cv2))[0]);
  check("espera abierta", w2?.status === "open", w2);
  await sleep(1200);
  const sent = await socio.api(`/api/conversations/${cv2}/messages`, { method: "POST", body: { text: "Hola, soy del equipo, te ayudo" } });
  check("el miembro responde desde el CRM", sent.status < 300, sent.text.slice(0, 200));
  await fetch(`${BASE}/api/dev/push-mock`, { method: "DELETE" });
  r = await sweep(new Date(new Date(w2.started_at).getTime() + 15 * MIN));
  const [w2b] = await waitsOf(cv2);
  check("cerrada como answered por Socio Demo vía CRM", w2b.status === "answered" && w2b.responder_name === "Socio Demo" && w2b.responder_via === "crm" && w2b.response_ms > 0 && w2b.response_ms < 60_000, w2b);
  check("sin aviso", w2b.alerted_at === null && (await deliveries()) === 0);
  const msgs = await owner.api(`/api/conversations/${cv2}/messages`);
  const mine = (msgs.json?.messages ?? msgs.json ?? []).find?.((m) => m.text === "Hola, soy del equipo, te ayudo");
  check("firma: sentByName en el DTO", mine?.sentByName === "Socio Demo", mine);

  console.log("\n[4. IA apagada → espera ai_off]");
  const p3 = phone(3);
  await inbound(p3, "Hola, consulta");
  const cv3 = await until(() => convOf(p3));
  await sleep(4000);
  const off = await owner.api(`/api/conversations/${cv3}`, { method: "PATCH", body: { aiEnabled: false } });
  check("IA apagada", off.status < 300, off.status);
  check("sin espera todavía", (await waitsOf(cv3)).length === 0, await waitsOf(cv3));
  await inbound(p3, "¿Me responden?");
  const w3 = await until(async () => (await waitsOf(cv3))[0]);
  check("espera ai_off con el mensaje que la abrió", w3?.start_reason === "ai_off" && w3.start_message_id, w3);

  console.log("\n[5. aviso apagado → registra, no avisa]");
  await owner.api("/api/settings/attention", { method: "PUT", body: { alertEnabled: false, alertMinutes: 15 } });
  await fetch(`${BASE}/api/dev/push-mock`, { method: "DELETE" });
  r = await sweep(new Date(new Date(w3.started_at).getTime() + 30 * MIN));
  const [w3b] = await waitsOf(cv3);
  check("sigue abierta y sin aviso", w3b.status === "open" && w3b.alerted_at === null && (await deliveries()) === 0, w3b);

  console.log("\n[6. push 410 → se poda la suscripción, no se reintenta]");
  await owner.api("/api/settings/attention", { method: "PUT", body: { alertEnabled: true, alertMinutes: 5 } });
  const p4 = phone(4);
  await inbound(p4, "Quiero hablar con un humano");
  const cv4 = await until(() => convOf(p4));
  const w4 = await until(async () => (await waitsOf(cv4))[0]);
  await sleep(1500); // el push de derivación de 013 sale primero
  // Ahora el dispositivo del dueño «muere» (410) antes del aviso.
  await owner.api("/api/push/subscriptions", { method: "DELETE", body: { endpoint: ownerSub.endpoint } });
  const deadSub = { endpoint: `${BASE}/api/dev/push-mock?status=410`, keys: { p256dh: key(), auth: b64u(randomBytes(16)) }, mode: "handoff" };
  await owner.api("/api/push/subscriptions", { method: "POST", body: deadSub });
  await fetch(`${BASE}/api/dev/push-mock`, { method: "DELETE" });
  r = await sweep(new Date(new Date(w4.started_at).getTime() + 6 * MIN));
  await sleep(1500);
  const [w4b] = await waitsOf(cv4);
  const subs = await sql`select endpoint from push_subscription where organization_id = ${ORG} and endpoint like '%status=410%'`;
  check("reservado y entregado con 410", w4b.alerted_at !== null && (await deliveries()) >= 1, { r, d: await deliveries() });
  check("suscripción muerta podada", subs.length === 0, subs);
  const before = await deliveries();
  await sweep(new Date(new Date(w4.started_at).getTime() + 10 * MIN));
  await sleep(1000);
  check("no se reintenta", (await deliveries()) === before);
  // La espera del caso 3 (ai_off, 30 min) también se avisó ahora con el aviso en 5: es correcto (abierta).

  console.log("\n[7. el agente retoma → agent]");
  await owner.api(`/api/conversations/${cv3}`, { method: "PATCH", body: { aiEnabled: true } });
  await inbound(p3, "Te sigo escribiendo [e2e_etapa:En conversación]");
  await sleep(6000);
  await sweep(new Date());
  const w3c = (await waitsOf(cv3))[0];
  check("la espera ai_off se cierra como agent cuando responde la IA", w3c.status === "agent", w3c);

  console.log("\n[8. última vez en el CRM]");
  await sql`update member set last_seen_at = null where organization_id = ${ORG} and user_id = ${socioUser.id}`;
  const ctrl = new AbortController();
  const es = await fetch(`${BASE}/api/events`, { headers: { cookie: socio.cookie }, signal: ctrl.signal });
  const reader = es.body.getReader(); await reader.read(); await sleep(800); ctrl.abort();
  const [seen] = await sql`select last_seen_at from member where organization_id = ${ORG} and user_id = ${socioUser.id}`;
  check("last_seen_at al abrir la app", seen?.last_seen_at !== null, seen);

  console.log("\n[9. Métricas en vivo]");
  const team = await owner.api("/api/metrics/team?range=day&tz=America/Argentina/Cordoba");
  const socioRow = team.json.people.find((p) => p.name === "Socio Demo");
  check("Socio Demo con ≥1 espera respondida y última vez", socioRow && socioRow.waitsAnswered >= 1 && socioRow.lastSeenAt, socioRow);
  check("Socio Demo con avisos activos (todos los mensajes)", socioRow?.push.devices === 1 && socioRow.push.modes.includes("all"), socioRow?.push);
  check("esperando ahora incluye la del caso 2", team.json.waitingNow.some((x) => x.conversationId === cv1), team.json.waitingNow.map((x) => x.contactName));
} finally {
  await sql`delete from push_subscription where organization_id = ${ORG}`;
  await sql`delete from member where id = 'mem_a48_live_socio'`;
  if (prevSettings) await sql`update attention_settings set alert_enabled = ${prevSettings.alert_enabled}, alert_minutes = ${prevSettings.alert_minutes} where organization_id = ${ORG}`;
  else await sql`delete from attention_settings where organization_id = ${ORG}`;
  await sql.end();
  done();
}
