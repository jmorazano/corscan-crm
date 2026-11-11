// E2E 051 — calendarios iCal (Airbnb). Conduce el dev server con mocks
// (wa-mock + ai-mock + ical-mock) como propietario y como cliente de
// WhatsApp. Uso: DATABASE_URL=… node tests/e2e/fixtures/ical-e2e.mjs
// (desde la raíz del repo, para que resuelva `postgres`).
import postgres from "postgres";
import { BASE, check, done, login, sleep } from "./attention-lib.mjs";

const ORG = process.env.ICAL_E2E_ORG ?? "org_x063bgv6kib0cum49tz7"; // Inmobiliaria Demo
const PNID = process.env.ICAL_E2E_PNID ?? "222222222";
const OWNER = { email: "socio@vocero.test", password: "Vocero2026!" };
const MEMBER = { email: "e2e@vocero.test", password: "E2eVocero2026!" };
const sql = postgres(process.env.DATABASE_URL);
const feed = (id, token = `tok${id}abcd`) => `${BASE}/api/dev/ical-mock/calendar/ical/${id}.ics?t=${token}`;
const phones = [];

async function mock(knobs) {
  const r = await fetch(`${BASE}/api/dev/ical-mock/state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(knobs),
  });
  if (!r.ok) throw new Error(`ical-mock ${r.status}`);
}
async function mockHits() {
  return (await (await fetch(`${BASE}/api/dev/ical-mock/state`)).json()).hits;
}
async function devSync(body) {
  return (await fetch(`${BASE}/api/dev/ical-sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })).json();
}
async function outboxFor(phone) {
  const { outbox } = await (await fetch(`${BASE}/api/dev/wa-mock/outbox`)).json();
  const tail = phone.slice(-8);
  return outbox.filter((m) => String(m.to ?? "").endsWith(tail));
}
function textOfOut(m) {
  return m.body?.text?.body ?? JSON.stringify(m.body ?? m);
}
async function say(phone, text) {
  const before = (await outboxFor(phone)).length;
  const r = await fetch(`${BASE}/api/dev/wa-mock/inbound`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumberId: PNID, from: phone, name: "Huésped 051", text }),
  });
  if (!r.ok) throw new Error(`inbound ${r.status} ${await r.text()}`);
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const out = await outboxFor(phone);
    if (out.length > before) {
      await sleep(400);
      return (await outboxFor(phone)).slice(before).map(textOfOut).join("\n");
    }
  }
  return null;
}
function newPhone() {
  const p = `54935100${String(Date.now()).slice(-5)}${phones.length}`;
  phones.push(p);
  return p;
}

const [{ reply_delay_ms: originalDelay } = { reply_delay_ms: null }] =
  await sql`select reply_delay_ms from agent_profile where organization_id = ${ORG}`;

try {
  await sql`update agent_profile set reply_delay_ms = 1000 where organization_id = ${ORG}`;
  await sql`delete from ical_unit where organization_id = ${ORG}`;
  await sql`delete from ical_integration where organization_id = ${ORG}`;
  await mock({ reset: true });
  await mock({ setBusy: { id: "1001", ranges: [{ from: "2026-12-10", to: "2026-12-16" }] } });

  const owner = await login(OWNER.email, OWNER.password);
  const sw = await owner.api("/api/workspaces/switch", { method: "POST", body: { organizationId: ORG } });
  check("propietario en Inmobiliaria Demo", sw.status === 200, sw.json);
  const member = await login(MEMBER.email, MEMBER.password);
  await member.api("/api/workspaces/switch", { method: "POST", body: { organizationId: ORG } });

  console.log("A — alta de unidades");
  let r = await owner.api("/api/integrations/airbnb-calendars");
  check("GET vacío", r.status === 200 && r.json.units.length === 0, r.json);
  r = await owner.api("/api/integrations/airbnb-calendars/units", {
    method: "POST",
    body: { name: "Cabaña Mala", capacity: 2, icalUrl: "https://evil.example.com/calendar/ical/1.ics" },
  });
  check("host ajeno → 400 invalid_url", r.status === 400 && r.json.error.code === "invalid_url", r.json);
  await mock({ garbageNext: "1009" });
  r = await owner.api("/api/integrations/airbnb-calendars/units", {
    method: "POST",
    body: { name: "Cabaña Rara", capacity: 2, icalUrl: feed("1009") },
  });
  check("no es un calendario → 422 y no se guarda", r.status === 422 && r.json.error.code === "feed", r.json);
  r = await owner.api("/api/integrations/airbnb-calendars/units", {
    method: "POST",
    body: { name: "Cabaña Abeto", capacity: 4, description: "Hogar a leña", icalUrl: feed("1001", "secretoabeto1234") },
  });
  check("alta Abeto 201 con su ocupación", r.status === 201 && r.json.unit.busyRanges === 1, r.json);
  check("la llave no vuelve al navegador", !r.text.includes("secretoabeto") && r.json.unit.tokenLast4 === "1234", r.text);
  r = await owner.api("/api/integrations/airbnb-calendars/units", {
    method: "POST",
    body: { name: "Cabaña Abeto bis", capacity: 4, icalUrl: feed("1001") },
  });
  check("mismo calendario → 409", r.status === 409, r.json);
  r = await owner.api("/api/integrations/airbnb-calendars/units", {
    method: "POST",
    body: {
      name: "Cabaña Pino",
      capacity: 6,
      icalUrl: feed("1002"),
      bookingUrl: "https://bosque.example/pino?in={entrada}&out={salida}&p={huespedes}",
    },
  });
  check("alta Pino con enlace propio", r.status === 201, r.json);
  r = await owner.api("/api/integrations/airbnb-calendars/units", {
    method: "POST",
    body: { name: "Cabaña Roble", capacity: 2, icalUrl: feed("1003") },
  });
  check("alta Roble", r.status === 201, r.json);
  r = await owner.api("/api/integrations/airbnb-calendars", {
    method: "PUT",
    body: { bookingUrl: "https://bosque.example/reservar?in={entrada}&out={salida}" },
  });
  check("enlace general guardado", r.status === 200, r.json);
  r = await owner.api("/api/integrations/airbnb-calendars", { method: "PUT", body: { bookingUrl: "javascript:alert(1)" } });
  check("enlace general inválido → 400", r.status === 400, r.json);
  r = await owner.api("/api/integrations/airbnb-calendars");
  check("GET: 3 unidades + grilla de 30 días", r.json.units.length === 3 && Object.values(r.json.grid)[0].length === 30, r.json);
  check("GET sin URLs ni llaves", !r.text.includes("ical-mock") && !r.text.includes("secretoabeto"), r.text.slice(0, 300));
  const m403 = await member.api("/api/integrations/airbnb-calendars");
  check("miembro → 403", m403.status === 403, m403.json);
  const idx = await owner.api("/api/integrations");
  const card = idx.json.integrations.find((i) => i.key === "airbnb_calendars");
  check("tarjeta del índice «3 unidades»", card?.connected && card.accountEmail === "3 unidades", card);
  const [row] = await sql`select ical_url_cipher, busy_ranges from ical_unit where organization_id = ${ORG} and listing_id = '1001'`;
  check("enlace cifrado en la BD", row && !row.ical_url_cipher.includes("ical-mock"), row);

  console.log("B — el agente consulta");
  const hitsBefore = JSON.stringify(await mockHits());
  const p1 = newPhone();
  let reply = await say(p1, "Hola, ¿tienen lugar del 2026-12-12 al 2026-12-15 para 4 personas?");
  console.log(`    agente: ${reply}`);
  check("respondió", reply !== null, reply);
  check("nombra Pino (libre, alcanza)", reply?.includes("Cabaña Pino"), reply);
  check("no ofrece Abeto (ocupada) ni Roble (chica)", reply && !reply.includes("Abeto") && !reply.includes("Roble"), reply);
  check(
    "enlace propio de Pino con fechas y huéspedes",
    reply?.includes("https://bosque.example/pino?in=2026-12-12&out=2026-12-15&p=4"),
    reply
  );
  check("nunca la publicación de Airbnb", reply && !/airbnb/i.test(reply), reply);
  check("el turno no salió a la red", JSON.stringify(await mockHits()) === hitsBefore, await mockHits());
  const [lead] = await sql`
    select s.name, c.notes from lead l join contact c on c.id = l.contact_id join pipeline_stage s on s.id = l.stage_id
    where c.organization_id = ${ORG} and c.phone like ${"%" + p1.slice(-8)}`;
  check("lead en etapa de interesados (044)", lead && /interes/i.test(lead.name), lead);

  reply = await say(p1, "[E2E_STAYS_PROMESA] ¿y del 2026-12-20 al 2026-12-22 para 2?");
  console.log(`    agente: ${reply}`);
  check("la promesa de reserva no sale", reply && !/reserv[eé]|quedó reservada/i.test(reply.replace(/reservar/gi, "")), reply);

  await mock({ setBusy: { id: "1002", ranges: [{ from: "2026-12-11", to: "2026-12-18" }] } });
  await mock({ setBusy: { id: "1003", ranges: [{ from: "2026-12-12", to: "2026-12-14" }] } });
  await devSync({ organizationId: ORG, ageMs: 20 * 60 * 1000, tick: true });
  const p2 = newPhone();
  reply = await say(p2, "Buenas, ¿hay lugar del 2026-12-12 al 2026-12-15 para 2?");
  console.log(`    agente: ${reply}`);
  check("sin lugar → ofrece fechas cercanas", reply?.includes("no tengo lugar") && /\d{2}\/12\/2026/.test(reply), reply);

  console.log("C — calendarios viejos o caídos");
  await devSync({ organizationId: ORG, ageMs: 4 * 60 * 60 * 1000 });
  const p3 = newPhone();
  reply = await say(p3, "Hola, ¿tienen lugar del 2026-12-20 al 2026-12-22 para 2?");
  console.log(`    agente: ${reply}`);
  check("snapshot de 4 h → no ofrece nada", reply && !reply.includes("Cabaña") && /confirmar/i.test(reply), reply);

  await mock({ guestData: true, setBusy: { id: "1001", ranges: [{ from: "2026-12-01", to: "2026-12-05" }, { from: "2026-12-10", to: "2026-12-16" }] } });
  await mock({ failAlways: { id: "1002", status: 404 } });
  const [pinoBefore] = await sql`select busy_ranges from ical_unit where organization_id = ${ORG} and listing_id = '1002'`;
  await devSync({ organizationId: ORG, ageMs: 20 * 60 * 1000, tick: true });
  // Las marcas se guardan en UTC sin zona: se compara en la BD.
  const units = await sql`select listing_id, busy_ranges, last_error,
    (timezone('utc', now()) - last_ok_at) > interval '19 minutes' as old
    from ical_unit where organization_id = ${ORG} order by listing_id`;
  const abeto = units.find((u) => u.listing_id === "1001");
  const pino = units.find((u) => u.listing_id === "1002");
  check("Abeto leída con la reserva nueva", abeto?.busy_ranges.length === 2 && abeto.last_error === null, abeto);
  const dump = JSON.stringify(units);
  check("los datos del huésped no se guardan", !dump.includes("9876") && !dump.includes("HMMOCK") && !dump.includes("Reserv"), dump);
  check("Pino 404 → link_revoked", pino?.last_error === "link_revoked", pino);
  check(
    "Pino conserva el último dato bueno",
    JSON.stringify(pino?.busy_ranges) === JSON.stringify(pinoBefore.busy_ranges) &&
      // `ageMs` corre las lecturas 20 min para atrás: si la fallida no tocó
      // last_ok_at, sigue ahí (no «ahora»).
      pino.old === true,
    pino
  );
  const idx2 = await owner.api("/api/integrations");
  check(
    "tarjeta avisa «Requiere reconexión»",
    idx2.json.integrations.find((i) => i.key === "airbnb_calendars")?.status === "reconnect_required"
  );
  const view = await owner.api("/api/integrations/airbnb-calendars");
  check(
    "panel explica el error en criollo",
    view.json.units.find((u) => u.listingId === "1002")?.lastErrorText?.includes("ya no existe"),
    view.json.units
  );
  await mock({ redirectNext: "1003" });
  await devSync({ organizationId: ORG, ageMs: 20 * 60 * 1000, tick: true });
  const [roble] = await sql`select last_error from ical_unit where organization_id = ${ORG} and listing_id = '1003'`;
  check("redirección a metadata → invalid, sin seguirla", roble.last_error === "invalid", roble);

  r = await owner.api("/api/integrations/airbnb-calendars/sync", { method: "POST" });
  check("«Leer ahora» responde", r.status === 200, r.json);
  r = await owner.api("/api/integrations/airbnb-calendars/sync", { method: "POST" });
  check("«Leer ahora» dos veces seguidas → 429", r.status === 429, r.json);

  console.log("D — switch apagado");
  await mock({ failAlways: { id: "1002", status: null } });
  await owner.api("/api/integrations/airbnb-calendars", { method: "PUT", body: { agentEnabled: false } });
  const p4 = newPhone();
  reply = await say(p4, "Hola, ¿tienen lugar del 2026-12-20 al 2026-12-22 para 2?");
  console.log(`    agente: ${reply}`);
  check("apagado → no consulta calendarios", reply !== null && !reply.includes("Cabaña"), reply);

  console.log("E — edición y borrado");
  const list = (await owner.api("/api/integrations/airbnb-calendars")).json.units;
  const roble2 = list.find((u) => u.listingId === "1003");
  r = await owner.api(`/api/integrations/airbnb-calendars/units/${roble2.id}`, {
    method: "PATCH",
    body: { name: "Cabaña Roble", capacity: 3, icalUrl: "" },
  });
  check("editar sin enlace conserva el calendario", r.status === 200 && r.json.unit.capacity === 3 && r.json.unit.listingId === "1003", r.json);
  r = await owner.api(`/api/integrations/airbnb-calendars/units/${roble2.id}`, { method: "DELETE" });
  check("quitar unidad", r.status === 200, r.json);
  r = await member.api(`/api/integrations/airbnb-calendars/units/${list[0].id}`, { method: "DELETE" });
  check("miembro no puede quitar → 403", r.status === 403, r.json);
} finally {
  await sql`update agent_profile set reply_delay_ms = ${originalDelay} where organization_id = ${ORG}`;
  for (const p of phones) {
    const cts = await sql`select id from contact where organization_id = ${ORG} and phone like ${"%" + p.slice(-8)}`;
    for (const c of cts) {
      await sql`delete from conversation where organization_id = ${ORG} and contact_id = ${c.id}`;
      await sql`delete from lead where organization_id = ${ORG} and contact_id = ${c.id}`;
      await sql`delete from contact where id = ${c.id}`;
    }
  }
  await sql`delete from ical_unit where organization_id = ${ORG}`;
  await sql`delete from ical_integration where organization_id = ${ORG}`;
  await sql.end();
  done();
}
