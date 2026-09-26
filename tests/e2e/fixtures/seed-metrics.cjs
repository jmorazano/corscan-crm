// E2E 024 (tests/e2e/024-owner-metrics.md): siembra en la BD LOCAL una
// empresa aislada «Métricas E2E» (owner: e2e@vocero.test) con mensajes de
// valores conocidos —relativos a AHORA— e imprime lo que /api/metrics tiene
// que devolver en el rango diario. Re-ejecutable (borra y recrea la
// empresa). Desde la raíz del repo:
//
//   node tests/e2e/fixtures/seed-metrics.cjs            # sembrar
//   node tests/e2e/fixtures/seed-metrics.cjs --cleanup  # borrar la empresa
const fs = require('fs');
const root = process.cwd();
const env = fs.readFileSync(root + '/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)[1];
const postgres = require(root + '/node_modules/postgres/cjs/src/index.js');
const sql = postgres(url, { onnotice: () => {} });

const ORG = 'org_metrics_e2e';
const TZ = 'America/Argentina/Buenos_Aires';
const now = Date.now();
const MIN = 60_000, DAY = 86_400_000;
let seq = 0;
const id = (p) => `${p}_m24_${(++seq).toString().padStart(4, '0')}`;
const iso = (t) => new Date(t).toISOString();
const localKey = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));

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

  const series = {}; // key → {whatsapp, instagram}
  const bump = (t, ch) => { const k = localKey(t); series[k] ??= { whatsapp: 0, instagram: 0 }; series[k][ch]++; };

  // A: grupo de 2 entrantes → agente a los 2 min del PRIMERO (120 s).
  const t0 = now - 3 * DAY;
  await msg(A, 'in', t0); bump(t0, 'whatsapp');
  await msg(A, 'in', t0 + MIN); bump(t0 + MIN, 'whatsapp');
  await msg(A, 'out', t0 + 2 * MIN, { ai: true });
  // A: grupo respondido por una PERSONA → no cuenta en el tiempo.
  await msg(A, 'in', t0 + 10 * MIN); bump(t0 + 10 * MIN, 'whatsapp');
  await msg(A, 'out', t0 + 11 * MIN);
  // A: saliente del agente FALLIDO (no responde) y luego el bueno a los 90 s.
  const t1 = now - 2 * DAY;
  await msg(A, 'in', t1); bump(t1, 'whatsapp');
  await msg(A, 'out', t1 + 30_000, { ai: true, status: 'failed' });
  await msg(A, 'out', t1 + 90_000, { ai: true });
  // A: historial importado → no cuenta.
  await msg(A, 'in', now - 5 * DAY, { source: 'history' });
  await msg(A, 'out', now - 5 * DAY + MIN, { source: 'history' });
  // B (Instagram): agente a los 40 s; la reacción no es un mensaje.
  const t2 = now - 1 * DAY;
  await msg(B, 'in', t2); bump(t2, 'instagram');
  await msg(B, 'out', t2 + 40_000, { ai: true });
  await msg(B, 'in', t2 + 2 * MIN, { type: 'reaction', text: '❤️' });
  // Laboratorio y Entrenador → nunca cuentan.
  await msg(LAB, 'in', t2); await msg(LAB, 'out', t2 + 5000, { ai: true });
  await msg(TR, 'out', t2); await msg(TR, 'in', t2 + 5000, { ai: true });
  // Período anterior (hace 40 días): 1 recibido, agente a los 60 s.
  const tp = now - 40 * DAY;
  await msg(A, 'in', tp); await msg(A, 'out', tp + 60_000, { ai: true });

  const expected = {
    received: { total: 5, whatsapp: 4, instagram: 1, previous: 1 },
    agentSent: { total: 3, previous: 1, allSent: 4 },
    responseTime: { avgMs: (120_000 + 90_000 + 40_000) / 3, medianMs: 90_000, count: 3, previousAvgMs: 60_000 },
    series,
  };
  console.log(JSON.stringify(expected, null, 2));
  await sql.end();
})().catch(async (e) => { console.error(e); await sql.end(); process.exit(1); });
