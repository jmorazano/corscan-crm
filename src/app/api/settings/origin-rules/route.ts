import { apiError, parseBody, withOwner } from "@/lib/api";
import { MAX_ORIGIN_RULES, originRuleInput } from "@/lib/contact-origin";
import { createOriginRule, listOriginRules } from "@/server/contact-origin";

export const dynamic = "force-dynamic";

function serialize(rule: Awaited<ReturnType<typeof listOriginRules>>[number]) {
  return {
    id: rule.id,
    phrase: rule.phrase,
    tag: rule.tag,
    appendMonth: rule.appendMonth,
    createdAt: rule.createdAt.toISOString(),
  };
}

/** Reglas por frase de la empresa (043). Configuración: solo el propietario. */
export const GET = withOwner(async (session) => {
  const rules = await listOriginRules(session.organizationId);
  return Response.json({ rules: rules.map(serialize), max: MAX_ORIGIN_RULES });
});

export const POST = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, originRuleInput);
  if (!body.ok) return body.response;
  const result = await createOriginRule(session.organizationId, body.data);
  if (!result.ok) {
    return apiError(409, "limit", `Hasta ${MAX_ORIGIN_RULES} reglas por empresa.`);
  }
  return Response.json({ rule: serialize(result.rule) }, { status: 201 });
});
