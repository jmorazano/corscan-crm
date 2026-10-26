// E2E 024 (tests/e2e/024-owner-metrics.md): siembra en la BD LOCAL una
// empresa aislada «Métricas E2E» (owner: e2e@vocero.test) con mensajes de
// valores conocidos —relativos a AHORA— e imprime lo que /api/metrics tiene
// que devolver en el rango diario. Re-ejecutable (borra y recrea la
// empresa). Desde la raíz del repo:
//
//   node tests/e2e/fixtures/seed-metrics.mjs            # sembrar
//   node tests/e2e/fixtures/seed-metrics.mjs --cleanup  # borrar la empresa
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const env = readFileSync(join(root, ".env"), "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1];
const sql = postgres(url, { onnotice: () => {} });

const ORG = 'org_metrics_e2e';
const TZ = 'America/Argentina/Buenos_Aires';
const now = Date.now();
const MIN = 60_000, DAY = 86_400_000;
let seq = 0;
const id = (p) => `${p}_m24_${(++seq).toString().padStart(4, '0')}`;
const iso = (t) => new Date(t).toISOString();
const localKey = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
// Lunes local de la semana de `t` (date_trunc('week') de Postgres).
const localWeekKey = (t) => {
  const [y, mo, d] = localKey(t).split('-').map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
};

(async () => {
  const [u] = await sql`select id from "user" where email = 'e2e@vocero.test'`;
  if (!u) throw new Error('falta e2e@vocero.test');
  await sql`delete from organization where id = ${ORG}`;
  if (process.argv.includes('--cleanup')) {
    console.log('empresa Métricas E2E borrada');
    await sql.end();
    return;
  }
  await sql`insert into organization (id, name, slug) values (${ORG}, 'Métricas E2E', 'metricas-e2e')`;
  await sql`insert into member (id, organization_id, user_id, role) values (${'mem_m24'}, ${ORG}, ${u.id}, 'owner')`;
  await sql`insert into agent_profile ${sql({ id: 'ap_m24', organization_id: ORG, reply_delay_ms: 15000 }, 'id', 'organization_id', 'reply_delay_ms')}`.catch(async (e) => {
    // Si el perfil exige más columnas, se omite: la espera cae en la de instancia.
    console.warn('agent_profile omitido:', e.message);
  });

  async function conv(kind, isTest, phone) {
    const ct = id('ct');
    await sql`insert into contact (id, organization_id, phone, name, channel, is_test) values (${ct}, ${ORG}, ${phone}, ${'Cliente ' + phone}, ${kind === 'instagram' ? 'instagram' : 'whatsapp'}, ${isTest})`;
    const cv = id('cv');
    await sql`insert into conversation (id, organization_id, contact_id, is_test, kind) values (${cv}, ${ORG}, ${ct}, ${isTest}, ${kind})`;
    return cv;
  }
  async function msg(cv, direction, t, extra = {}) {
    const row = {
      id: id('msg'), organization_id: ORG, conversation_id: cv, direction,
      type: extra.type ?? 'text', text: extra.text ?? 'hola', status: extra.status ?? (direction === 'in' ? 'delivered' : 'sent'),
      ai_generated: extra.ai ?? false, source: extra.source ?? 'cloud', created_at: iso(t),
    };
    await sql`insert into message ${sql(row)}`;
    return t;
  }

  const A = await conv('whatsapp', false, '5493510000001');
  const B = await conv('instagram', false, 'ig:1700000000000001');
  const LAB = await conv('whatsapp', true, '5493510000009');
  const TR = await conv('trainer', true, 'trainer');

  // key → {whatsapp, instagram, past, conversations}: conversaciones
  // DISTINTAS con recibidos en vivo en la barra (el pasado no suma).
  const series = {};
  const weekConvs = {}; // lunes → Set de conversaciones (rango semanal)
  const convsIn = {};
  const bump = (t, ch, cv) => {
    const k = localKey(t);
    series[k] ??= { whatsapp: 0, instagram: 0, past: 0, conversations: 0 };
    series[k][ch]++;
    if (ch === 'past') return;
    (convsIn[k] ??= new Set()).add(cv);
    series[k].conversations = convsIn[k].size;
    (weekConvs[localWeekKey(t)] ??= new Set()).add(cv);
  };

  // A: grupo de 2 entrantes → agente a los 2 min del PRIMERO (120 s).
  const t0 = now - 3 * DAY;
  await msg(A, 'in', t0); bump(t0, 'whatsapp', A);
  await msg(A, 'in', t0 + MIN); bump(t0 + MIN, 'whatsapp', A);
  await msg(A, 'out', t0 + 2 * MIN, { ai: true });
  // A: grupo respondido por una PERSONA → no cuenta en el tiempo.
  await msg(A, 'in', t0 + 10 * MIN); bump(t0 + 10 * MIN, 'whatsapp', A);
  await msg(A, 'out', t0 + 11 * MIN);
  // A: saliente del agente FALLIDO (no responde) y luego el bueno a los 90 s.
  const t1 = now - 2 * DAY;
  await msg(A, 'in', t1); bump(t1, 'whatsapp', A);
  await msg(A, 'out', t1 + 30_000, { ai: true, status: 'failed' });
  await msg(A, 'out', t1 + 90_000, { ai: true });
  // A: historial importado de WhatsApp → no cuenta en las tarjetas; los
  // RECIBIDOS van al histograma como «pasado» (los salientes, no).
  await msg(A, 'in', now - 5 * DAY, { source: 'history' }); bump(now - 5 * DAY, 'past');
  await msg(A, 'out', now - 5 * DAY + MIN, { source: 'history' });
  const th = now - 20 * DAY;
  for (let i = 0; i < 6; i++) { await msg(A, 'in', th + i * MIN, { source: 'history' }); bump(th + i * MIN, 'past'); }
  await msg(A, 'in', th + 10 * MIN, { source: 'history', type: 'reaction', text: '👍' }); // reacción: no
  // Día de la conexión: historial y mensajes en vivo en la MISMA barra
  // (el pasado va apilado en la base). Antes del primer entrante en vivo,
  // así no cambia el tiempo de respuesta.
  for (let i = 1; i <= 2; i++) { await msg(A, 'in', t0 - i * MIN, { source: 'history' }); bump(t0 - i * MIN, 'past'); }
  // B: historial de Instagram (parcial, 20 por conversación) → nunca cuenta.
  await msg(B, 'in', now - 6 * DAY, { source: 'history' });
  await msg(B, 'in', now - 6 * DAY + MIN, { source: 'history' });
  // B (Instagram): agente a los 40 s; la reacción no es un mensaje.
  const t2 = now - 1 * DAY;
  await msg(B, 'in', t2); bump(t2, 'instagram', B);
  await msg(B, 'out', t2 + 40_000, { ai: true });
  await msg(B, 'in', t2 + 2 * MIN, { type: 'reaction', text: '❤️' });
  // C (WhatsApp): solo escribe, nadie le contesta (no toca el tiempo de
  // respuesta). 3 recibidos hace 8 días y 2 hace 1 día: SIEMPRE dos semanas
  // distintas → cuenta en ambas barras semanales y una sola vez en el total.
  const C = await conv('whatsapp', false, '5493510000003');
  const t3 = now - 8 * DAY;
  for (let i = 0; i < 3; i++) { await msg(C, 'in', t3 + i * MIN); bump(t3 + i * MIN, 'whatsapp', C); }
  for (let i = 0; i < 2; i++) { await msg(C, 'in', t2 + 5 * MIN + i * MIN); bump(t2 + 5 * MIN + i * MIN, 'whatsapp', C); }
  // Laboratorio y Entrenador → nunca cuentan.
  await msg(LAB, 'in', t2); await msg(LAB, 'out', t2 + 5000, { ai: true });
  await msg(TR, 'out', t2); await msg(TR, 'in', t2 + 5000, { ai: true });
  // Período anterior (hace 40 días): 1 recibido, agente a los 60 s.
  const tp = now - 40 * DAY;
  await msg(A, 'in', tp); await msg(A, 'out', tp + 60_000, { ai: true });
  (weekConvs[localWeekKey(tp)] ??= new Set()).add(A); // dentro de las 12 semanas

  // Rango diario. Conversaciones: A (4 recibidos) y C (5) cuentan UNA vez
  // cada una; B, una. El período anterior: A (hace 40 días).
  const expected = {
    received: {
      total: 10, whatsapp: 9, instagram: 1, previous: 1, past: 9,
      conversations: { total: 3, whatsapp: 2, instagram: 1, previous: 1, previousWhatsapp: 1, previousInstagram: 0 },
    },
    agentSent: {
      total: 3, whatsapp: 2, instagram: 1, previous: 1, allSent: 4,
      conversations: { total: 2, whatsapp: 1, instagram: 1, previous: 1 },
    },
    responseTime: { medianMs: 90_000, avgMs: (120_000 + 90_000 + 40_000) / 3, count: 3, previousMedianMs: 60_000 },
    series,
    // Rango semanal: conversaciones distintas por barra (C en dos semanas).
    weekConversations: Object.fromEntries(Object.entries(weekConvs).sort().map(([k, v]) => [k, v.size])),
  };
  console.log(JSON.stringify(expected, null, 2));
  await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
