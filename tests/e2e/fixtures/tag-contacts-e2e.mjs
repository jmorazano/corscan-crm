#!/usr/bin/env node
// E2E 046 (tests/e2e/046-assistant-tag-contacts.md): Claude etiqueta
// contactos por el MCP. Siembra en la BD LOCAL, dentro de «Negocio de Super
// Admin Local», contactos propios (uno con el tope de 20 etiquetas y uno del
// Laboratorio), crea una conexión de asistente con un token de acceso (el
// flujo OAuth lo cubre mcp-client.mjs y no cambia en 046), conduce
// `tag_contacts` por el endpoint REAL /api/mcp y al final borra todo y deja
// el switch de asistentes como estaba.
//
//   node tests/e2e/fixtures/tag-contacts-e2e.mjs [--base http://localhost:3000]
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const env = readFileSync(join(root, ".env"), "utf8");
const sql = postgres(env.match(/^DATABASE_URL=(.*)$/m)[1], { onnotice: () => {} });
const i = process.argv.indexOf("--base");
const BASE = (i >= 0 ? process.argv[i + 1] : "http://localhost:3000").replace(/\/+$/, "");

const ORG = "org_m9651yzzrnaw62lwo4lm";
const TAG = "e2e-046";
const IDS = ["ct_e46_a", "ct_e46_b", "ct_e46_c", "ct_e46_full", "ct_e46_lab"];

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label} — ${JSON.stringify(detail).slice(0, 500)}`);
  }
}

const token = `vat_${randomBytes(32).toString("base64url")}`;
const suffix = randomBytes(6).toString("hex");
const clientId = `aclient_e46${suffix}`;
const grantId = `agrant_e46${suffix}`;

let rpcId = 0;
async function tool(name, args) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.json();
  const text = body.result?.content?.[0]?.text ?? "";
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, isError: body.result?.isError === true, text, data };
}
const tagsOf = async (id) => (await sql`select tags from contact where id = ${id}`)[0]?.tags ?? null;

const previousSwitch = (await sql`select enabled from assistant_settings where organization_id = ${ORG}`)[0]?.enabled;
const owner = (await sql`select m.user_id from member m join "user" u on u.id = m.user_id
  where m.organization_id = ${ORG} and m.role = 'owner' and u.email = 'e2e@vocero.test'`)[0]?.user_id;
if (!owner) throw new Error("e2e@vocero.test no es propietario de la empresa de prueba");

async function cleanup() {
  await sql`update member set role = 'owner' where organization_id = ${ORG} and user_id = ${owner}`;
  await sql`delete from contact where id in ${sql(IDS)}`;
  await sql`delete from assistant_grant where id = ${grantId}`;
  await sql`delete from assistant_client where id = ${clientId}`;
  await sql`delete from assistant_access_log where organization_id = ${ORG} and client_label = 'E2E 046'`;
  if (previousSwitch === undefined) await sql`delete from assistant_settings where organization_id = ${ORG}`;
  else await sql`update assistant_settings set enabled = ${previousSwitch} where organization_id = ${ORG}`;
}

try {
  await cleanup();
  const phone = (n) => `54935100460${n}`;
  await sql`insert into contact ${sql([
    { id: "ct_e46_a", organization_id: ORG, phone: phone(1), name: "Ana 046", channel: "whatsapp", is_test: false, tags: sql.array([TAG, "frio"]) },
    { id: "ct_e46_b", organization_id: ORG, phone: phone(2), name: "Beto 046", channel: "whatsapp", is_test: false, tags: sql.array([TAG, "vip"]) },
    { id: "ct_e46_c", organization_id: ORG, phone: phone(3), name: "Caro 046", channel: "whatsapp", is_test: false, tags: sql.array([TAG]) },
    { id: "ct_e46_full", organization_id: ORG, phone: phone(4), name: "Lleno 046", channel: "whatsapp", is_test: false,
      tags: sql.array([TAG, ...Array.from({ length: 19 }, (_, k) => `x${k}`)]) },
    { id: "ct_e46_lab", organization_id: ORG, phone: phone(9), name: "Laboratorio 046", channel: "whatsapp", is_test: true, tags: sql.array([TAG]) },
  ])}`;
  await sql`insert into assistant_settings (organization_id, enabled) values (${ORG}, true)
    on conflict (organization_id) do update set enabled = true, updated_at = now()`;
  await sql`insert into assistant_client ${sql({ id: clientId, client_name: "E2E 046", redirect_uris: sql.array(["http://127.0.0.1/cb"]) })}`;
  await sql`insert into assistant_grant ${sql({ id: grantId, user_id: owner, client_id: clientId, client_label: "E2E 046", resource: `${BASE}/api/mcp` })}`;
  await sql`insert into assistant_grant_org ${sql({ organization_id: ORG, grant_id: grantId })}`;
  await sql`insert into assistant_token ${sql({
    token_hash: createHash("sha256").update(token).digest("hex"), grant_id: grantId, kind: "access",
    expires_at: new Date(Date.now() + 3600_000),
  })}`;

  console.log("A. buscar y etiquetar por filtro");
  const search = await tool("search_contacts", { workspace: ORG, tags: [TAG] });
  check("search_contacts ve 4 (sin el del Laboratorio)", search.data?.total_matching === 4, search.data ?? search.text);
  const r1 = await tool("tag_contacts", { workspace: ORG, filter: { tags: [TAG] }, expected_count: 4, add: ["Interesado-LIDAR"], remove: ["frio"] });
  check("aplica", r1.data?.applied === true, r1.data ?? r1.text);
  check("4 encontrados, 3 cambiados (el lleno no cambia)", r1.data?.matched === 4 && r1.data?.updated === 3, r1.data);
  const added = r1.data?.added?.find((g) => g.tag === "interesado-lidar");
  check("la etiqueta se guarda en minúsculas y la ganan a, b y c", JSON.stringify(added?.contact_ids?.sort()) === JSON.stringify(["ct_e46_a", "ct_e46_b", "ct_e46_c"]), r1.data?.added);
  check("frio solo la pierde a", JSON.stringify(r1.data?.removed) === JSON.stringify([{ tag: "frio", count: 1, contact_ids: ["ct_e46_a"] }]), r1.data?.removed);
  check("el que tenía 20 etiquetas queda informado", r1.data?.not_added_tag_limit?.contact_ids?.[0] === "ct_e46_full", r1.data?.not_added_tag_limit);
  check("BD: a quedó con e2e-046 + interesado-lidar", JSON.stringify((await tagsOf("ct_e46_a")).sort()) === JSON.stringify([TAG, "interesado-lidar"].sort()), await tagsOf("ct_e46_a"));
  check("BD: el del Laboratorio no se tocó", JSON.stringify(await tagsOf("ct_e46_lab")) === JSON.stringify([TAG]), await tagsOf("ct_e46_lab"));

  console.log("B. repetir y deshacer");
  const again = await tool("tag_contacts", { workspace: ORG, filter: { tags: [TAG] }, expected_count: 4, add: ["interesado-lidar"], remove: ["frio"] });
  check("repetir no cambia nada (idempotente)", again.data?.applied === true && again.data?.updated === 0, again.data);
  const undo1 = await tool("tag_contacts", { workspace: ORG, contact_ids: added.contact_ids, remove: ["interesado-lidar"] });
  const undo2 = await tool("tag_contacts", { workspace: ORG, contact_ids: ["ct_e46_a"], add: ["frio"] });
  check("deshacer con lo informado", undo1.data?.updated === 3 && undo2.data?.updated === 1, [undo1.data, undo2.data]);
  check("BD: a volvió a e2e-046 + frio", JSON.stringify((await tagsOf("ct_e46_a")).sort()) === JSON.stringify([TAG, "frio"].sort()), await tagsOf("ct_e46_a"));

  console.log("C. protecciones");
  const stale = await tool("tag_contacts", { workspace: ORG, filter: { tags: [TAG] }, expected_count: 3, add: ["x"] });
  check("expected_count distinto → selection_changed y nada cambia", stale.data?.applied === false && stale.data?.code === "selection_changed" && stale.data?.matching === 4, stale.data);
  const noCount = await tool("tag_contacts", { workspace: ORG, filter: { tags: [TAG] }, add: ["x"] });
  check("filter sin expected_count → rechazado", noCount.data?.applied === false, noCount.data ?? noCount.text);
  const both = await tool("tag_contacts", { workspace: ORG, contact_ids: ["ct_e46_a"], filter: { tags: [TAG] }, expected_count: 4, add: ["x"] });
  check("ids y filter a la vez → rechazado", both.data?.applied === false, both.data ?? both.text);
  const pii = await tool("tag_contacts", { workspace: ORG, contact_ids: ["ct_e46_b"], add: ["351 555-1234", "ana@mail.com"] });
  check("etiquetas con pinta de teléfono o correo → rechazadas, nada escrito", pii.data?.applied === false && pii.data?.rejected_tags?.length === 2, pii.data);
  const mixed = await tool("tag_contacts", { workspace: ORG, contact_ids: ["ct_e46_b"], add: ["cliente-2026-10", "dni 30123456"] });
  check("mezcla: la válida (con fecha) se aplica y la otra se informa", mixed.data?.updated === 1 && mixed.data?.rejected_tags?.[0]?.tag === "dni 30123456", mixed.data);
  const lab = await tool("tag_contacts", { workspace: ORG, contact_ids: ["ct_e46_lab"], add: ["x"] });
  check("contacto del Laboratorio por id → 0 encontrados", lab.data?.matched === 0, lab.data);
  check("BD: el del Laboratorio sigue intacto", JSON.stringify(await tagsOf("ct_e46_lab")) === JSON.stringify([TAG]), await tagsOf("ct_e46_lab"));
  const foreign = await tool("tag_contacts", { workspace: ORG, contact_ids: ["ct_no_existe_046"], add: ["x"] });
  check("id ajeno o inexistente → 0 encontrados", foreign.data?.matched === 0, foreign.data);

  console.log("D. cortes de acceso");
  await sql`update assistant_settings set enabled = false where organization_id = ${ORG}`;
  const off = await tool("tag_contacts", { workspace: ORG, contact_ids: ["ct_e46_b"], add: ["x"] });
  check("switch apagado → denegado", off.isError === true, off.text);
  await sql`update assistant_settings set enabled = true where organization_id = ${ORG}`;
  await sql`update member set role = 'member' where organization_id = ${ORG} and user_id = ${owner}`;
  const member = await tool("tag_contacts", { workspace: ORG, contact_ids: ["ct_e46_b"], add: ["x"] });
  await sql`update member set role = 'owner' where organization_id = ${ORG} and user_id = ${owner}`;
  check("si deja de ser propietario → denegado", member.isError === true, member.text);
  check("BD: b no recibió «x»", !(await tagsOf("ct_e46_b")).includes("x"), await tagsOf("ct_e46_b"));

  console.log("E. tope por hora");
  await new Promise((r) => setTimeout(r, 500)); // el registro se escribe en segundo plano
  const used = (await sql`select count(*)::int n from assistant_access_log where organization_id = ${ORG}
    and tool = 'tag_contacts' and outcome = 'ok' and created_at > now() - interval '1 hour'`)[0].n;
  let last = null;
  for (let k = used; k < 21; k++) last = await tool("tag_contacts", { workspace: ORG, contact_ids: ["ct_e46_c"], add: ["tope"] });
  check("la llamada 21 de la hora → rate_limited", last?.data?.code === "rate_limited", last?.data ?? last?.text);
  const log = await sql`select outcome, reason, summary from assistant_access_log where organization_id = ${ORG}
    and client_label = 'E2E 046' and tool = 'tag_contacts' order by created_at`;
  check("todo queda en el registro de la empresa", log.length >= 15 && log.some((l) => /^Etiquetó 3 de 4/.test(l.summary)), log.slice(0, 3));
} finally {
  await cleanup();
  await sql.end();
}
console.log(failures === 0 ? "\nTODO VERDE" : `\n${failures} FALLAS`);
process.exit(failures === 0 ? 0 : 1);
