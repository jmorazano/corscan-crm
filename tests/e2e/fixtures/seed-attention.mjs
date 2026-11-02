// E2E 048 (tests/e2e/us-048-team-attention.md): siembra en la BD LOCAL una
// empresa aislada «Atención E2E» con esperas y mensajes de valores
// conocidos —relativos a AHORA— e imprime lo que /api/metrics/team tiene
// que devolver. Re-ejecutable (borra y recrea la empresa y sus personas).
//
//   node tests/e2e/fixtures/seed-attention.mjs            # sembrar
//   node tests/e2e/fixtures/seed-attention.mjs --cleanup  # borrar
//
// Personas: e2e@vocero.test (propietario), Lucía y Pedro (miembros sin
// contraseña: solo existen para las cifras), «Bruno» (cuenta ELIMINADA:
// sus mensajes conservan el nombre copiado) y socio@vocero.test (miembro
// con login, para probar «Mi atención» y el 403).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const env = readFileSync(join(root, ".env"), "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1];
const sql = postgres(url, { onnotice: () => {} });

const ORG = "org_attention_e2e";
const LUCIA = "usr_att_lucia";
const PEDRO = "usr_att_pedro";
const BRUNO = "usr_att_bruno";
const now = Date.now();
const MIN = 60_000;
let seq = 0;
const id = (p) => `${p}_a48_${(++seq).toString().padStart(4, "0")}`;
const at = (minutesAgo) => new Date(now - minutesAgo * MIN);

(async () => {
  const [owner] = await sql`select id from "user" where email = 'e2e@vocero.test'`;
  const [socio] = await sql`select id from "user" where email = 'socio@vocero.test'`;
  if (!owner || !socio) throw new Error("faltan e2e@vocero.test o socio@vocero.test");

  await sql`delete from organization where id = ${ORG}`;
  await sql`delete from "user" where id in (${LUCIA}, ${PEDRO}, ${BRUNO})`;
  if (process.argv.includes("--cleanup")) {
    console.log("empresa Atención E2E borrada");
    await sql.end();
    return;
  }

  await sql`insert into organization (id, name, slug) values (${ORG}, 'Atención E2E', 'atencion-e2e')`;
  for (const [uid, name, email] of [
    [LUCIA, "Lucía", "lucia-a48@vocero.test"],
    [PEDRO, "Pedro", "pedro-a48@vocero.test"],
    [BRUNO, "Bruno", "bruno-a48@vocero.test"],
  ]) {
    await sql`insert into "user" (id, name, email, email_verified) values (${uid}, ${name}, ${email}, true)`;
  }
  await sql`insert into member (id, organization_id, user_id, role) values
    ('mem_a48_owner', ${ORG}, ${owner.id}, 'owner'),
    ('mem_a48_lucia', ${ORG}, ${LUCIA}, 'member'),
    ('mem_a48_pedro', ${ORG}, ${PEDRO}, 'member'),
    ('mem_a48_bruno', ${ORG}, ${BRUNO}, 'member'),
    ('mem_a48_socio', ${ORG}, ${socio.id}, 'member')`;
  // Lucía con un dispositivo (solo derivaciones); Pedro sin ninguno.
  await sql`insert into push_subscription ${sql({
    id: "push_a48_lucia",
    organization_id: ORG,
    user_id: LUCIA,
    endpoint: "https://push.example.test/a48-lucia",
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
    mode: "handoff",
  })}`.catch((e) => console.warn("suscripción omitida:", e.message));

  async function conversation(name, phone) {
    const ct = id("ct");
    await sql`insert into contact (id, organization_id, phone, name) values (${ct}, ${ORG}, ${phone}, ${name})`;
    const cv = id("cv");
    await sql`insert into conversation (id, organization_id, contact_id, last_inbound_at, ai_enabled)
              values (${cv}, ${ORG}, ${ct}, ${at(0)}, false)`;
    return cv;
  }
  async function inbound(cv, minutesAgo, text) {
    const mid = id("msg");
    await sql`insert into message ${sql({
      id: mid, organization_id: ORG, conversation_id: cv, direction: "in", type: "text",
      text, status: "delivered", created_at: at(minutesAgo), wa_message_id: id("wamid"),
    })}`;
    return mid;
  }
  async function outbound(cv, minutesAgo, userId, name, extra = {}) {
    await sql`insert into message ${sql({
      id: id("msg"), organization_id: ORG, conversation_id: cv, direction: "out", type: "text",
      text: `Respuesta de ${name}`, status: "sent", created_at: at(minutesAgo),
      sent_by_user_id: userId, sent_by_name: name, wa_message_id: id("wamid"), ...extra,
    })}`;
  }
  async function wait(cv, startMinutesAgo, fields) {
    await sql`insert into attention_wait ${sql({
      id: id("aw"), organization_id: ORG, conversation_id: cv, started_at: at(startMinutesAgo),
      start_reason: "ai_off", status: "open", ...fields,
    })}`;
  }
  const answered = async (name, phone, userId, userName, startAgo, minutes) => {
    const cv = await conversation(name, phone);
    await inbound(cv, startAgo, "Hola, ¿hay lugar?");
    await outbound(cv, startAgo - minutes, userId, userName);
    await wait(cv, startAgo, {
      status: "answered", closed_at: at(startAgo - minutes), responder_user_id: userId,
      responder_name: userName, responder_via: "crm", response_ms: minutes * MIN,
    });
  };

  // Lucía: 2, 5 y 30 min (1 tarde con 15) · Pedro: 10 min.
  await answered("Cliente A", "5493510000001", LUCIA, "Lucía", 120, 2);
  await answered("Cliente B", "5493510000002", LUCIA, "Lucía", 110, 5);
  await answered("Cliente C", "5493510000003", LUCIA, "Lucía", 100, 30);
  await answered("Cliente D", "5493510000004", PEDRO, "Pedro", 90, 10);
  // Retomada por el agente, sin respuesta (vencida) y abierta ahora.
  const cvAgent = await conversation("Cliente E", "5493510000005");
  await wait(cvAgent, 80, { status: "agent", closed_at: at(70) });
  const cvExpired = await conversation("Cliente F", "5493510000006");
  await wait(cvExpired, 60, { status: "expired", closed_at: at(1) });
  const cvOpen = await conversation("Cliente G", "5493510000007");
  await inbound(cvOpen, 3, "¿Alguien me atiende?");
  await wait(cvOpen, 3, { status: "open" });

  // Mensajes extra de Lucía en una conversación (no son esperas).
  await outbound(cvAgent, 50, LUCIA, "Lucía");
  // Un fallido de Pedro: no cuenta.
  await outbound(cvAgent, 40, PEDRO, "Pedro", { status: "failed" });
  // Bruno escribió y después se eliminó su cuenta: queda el nombre copiado.
  await outbound(cvExpired, 30, BRUNO, "Bruno");
  await sql`delete from member where id = 'mem_a48_bruno'`;
  await sql`delete from "user" where id = ${BRUNO}`;

  // Aviso apagado → «tarde» = 15 min (default).
  console.log(
    JSON.stringify(
      {
        org: ORG,
        expected: {
          summary: { total: 7, onTime: 3, late: 1, agent: 1, unanswered: 1, open: 1, medianMin: 7.5 },
          lucia: { waitsAnswered: 3, waitsLate: 1, medianMin: 5, messages: 4, conversations: 4, push: "1 dispositivo · solo derivaciones" },
          pedro: { waitsAnswered: 1, waitsLate: 0, medianMin: 10, messages: 1, conversations: 1, push: "Sin avisos en ningún dispositivo" },
          bruno: { role: null, messages: 1 },
          waitingNow: 1,
          problems: 2,
        },
      },
      null,
      2
    )
  );
  await sql.end();
})().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
