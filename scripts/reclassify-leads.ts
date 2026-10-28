/**
 * 044: reclasifica los leads EXISTENTES de una empresa con las mismas reglas
 * fijas que ahora aplica el sistema. Por defecto SOLO informa (dry-run);
 * `--apply` escribe. Los perdidos no se tocan. Solo avanza (canAutoMove) y con compare-and-set: un lead
 * que alguien movió mientras corría queda como lo dejó esa persona.
 *
 *   Cliente     → el agente confirmó una escritura en el sistema del negocio
 *                 (032) o se anotó un comprobante en la planilla (034).
 *   Interesado  → consultó el sistema con fechas de entrada y salida.
 *   En conversación → el cliente escribió después de un mensaje del negocio.
 *
 * Uso (corre con `postgres` y DATABASE_URL, como en el contenedor):
 *   esbuild scripts/reclassify-leads.ts --bundle --platform=node --format=esm \
 *     --outfile=.tmp-reclassify.mjs --alias:@=./src --packages=external
 *   node .tmp-reclassify.mjs --org org_xxx [--apply]
 */
import postgres from "postgres";
import { canAutoMove, stageRoles, type StageLike, type StageRole } from "@/lib/lead-stages";

const args = process.argv.slice(2);
const org = args[args.indexOf("--org") + 1];
const apply = args.includes("--apply");
if (!org || args.indexOf("--org") < 0) {
  console.error("Falta --org <organization_id>");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });

type Row = {
  lead_id: string;
  stage_id: string;
  name: string;
  opted_out: boolean;
  wrote: boolean;
  receipt: boolean;
  dated_search: boolean;
  replied: boolean;
};

async function main(): Promise<void> {
  const stages = (await sql`
    select id, name, kind, position from pipeline_stage
    where organization_id = ${org} order by position`) as unknown as StageLike[];
  const roles = stageRoles(stages);
  const rows = (await sql`
    select l.id lead_id, l.stage_id, ct.name, ct.opted_out_at is not null opted_out,
      exists (select 1 from mcp_tool_call t join conversation c on c.id = t.conversation_id
              where c.contact_id = l.contact_id and t.organization_id = ${org}
                and t.write and t.status = 'ok') wrote,
      exists (select 1 from payment_receipt r
              where r.contact_id = l.contact_id and r.organization_id = ${org}
                and r.status = 'recorded') receipt,
      exists (select 1 from mcp_tool_call t join conversation c on c.id = t.conversation_id
              where c.contact_id = l.contact_id and t.organization_id = ${org}
                and t.status = 'ok' and t.args ?& array['check_in','check_out']) dated_search,
      exists (select 1 from conversation c
              join message o on o.conversation_id = c.id and o.direction = 'out' and o.source <> 'history'
              join message i on i.conversation_id = c.id and i.direction = 'in' and i.source <> 'history'
                and i.created_at > o.created_at
              where c.contact_id = l.contact_id and c.organization_id = ${org} and not c.is_test) replied
    from lead l join contact ct on ct.id = l.contact_id
    where l.organization_id = ${org}`) as unknown as Row[];

  const byId = new Map(stages.map((s) => [s.id, s]));
  const plan: { leadId: string; from: StageLike; to: StageLike; name: string }[] = [];
  for (const r of rows) {
    const current = byId.get(r.stage_id) ?? null;
    // Un perdido quedó perdido DESPUÉS de lo que muestra el historial (buscó
    // fechas y después dijo que no): la reclasificación no lo toca.
    if (!current || current.kind === "lost") continue;
    const wanted: StageRole | null =
      r.wrote || r.receipt ? "won" : r.dated_search ? "interested" : r.replied ? "talking" : null;
    const to = wanted ? roles[wanted] : undefined;
    if (!to || !canAutoMove(current, to, { optedOut: r.opted_out })) continue;
    plan.push({ leadId: r.lead_id, from: current, to, name: r.name });
  }

  const before = new Map<string, number>();
  for (const r of rows) before.set(r.stage_id, (before.get(r.stage_id) ?? 0) + 1);
  const after = new Map(before);
  const moves = new Map<string, { n: number; sample: string[] }>();
  for (const p of plan) {
    after.set(p.from.id, (after.get(p.from.id) ?? 0) - 1);
    after.set(p.to.id, (after.get(p.to.id) ?? 0) + 1);
    const key = `${p.from.name} → ${p.to.name}`;
    const m = moves.get(key) ?? { n: 0, sample: [] };
    m.n++;
    if (m.sample.length < 8) m.sample.push(p.name);
    moves.set(key, m);
  }
  console.log(apply ? "APLICANDO" : "INFORME (sin cambios; --apply para escribir)");
  console.log("\nEtapa                 antes   después");
  for (const s of stages) {
    console.log(`${s.name.padEnd(20)} ${String(before.get(s.id) ?? 0).padStart(6)} ${String(after.get(s.id) ?? 0).padStart(9)}`);
  }
  console.log("\nMovimientos:");
  for (const [key, m] of moves) console.log(`  ${key}: ${m.n}  (p. ej. ${m.sample.join(", ")})`);

  if (!apply) return;
  let done = 0;
  for (const p of plan) {
    const res = await sql`
      update lead set stage_id = ${p.to.id}, updated_at = now()
      where id = ${p.leadId} and organization_id = ${org} and stage_id = ${p.from.id}`;
    done += res.count;
  }
  console.log(`\nMovidos: ${done} de ${plan.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
