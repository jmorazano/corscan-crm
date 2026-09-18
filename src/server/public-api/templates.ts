import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { countVariables, validateParamValue } from "@/lib/template-body";
import {
  callerIndexes,
  exampleParams,
  publicVariables,
  type TemplateShape,
} from "@/lib/public-templates";
import { headerMediaUrl } from "@/server/whatsapp/templates";

/**
 * Plantillas de cara al integrador (014, FR-003). Lo puro (variables,
 * resolución de `params`) es unit-testeable; lo de BD vive abajo.
 */

type TemplateRow = typeof schema.template.$inferSelect;

export { publicVariables, callerIndexes } from "@/lib/public-templates";

export function serializePublicTemplate(
  t: TemplateRow,
  headerMediaId?: string | null
) {
  const variables = publicVariables(t);
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    body: t.body,
    header_image: Boolean(headerMediaId),
    header_image_url: headerMediaId ? headerMediaUrl(headerMediaId) : null,
    variables,
    example: {
      to: "+54 9 351 123 4567",
      name: "Nombre del cliente",
      template: t.name,
      language: t.language,
      params: exampleParams(variables),
    },
  };
}

export type ParamsResolution =
  | { ok: true; freeTexts?: string[]; variable?: string }
  | {
      ok: false;
      code:
        | "missing_params"
        | "unknown_params"
        | "invalid_param"
        | "template_not_supported";
      message: string;
      extra?: Record<string, unknown>;
    };

/**
 * Traduce `params` (índice → valor) a lo que entiende el embudo de envío:
 * `freeTexts` en orden para plantillas con orígenes, `variable` para la
 * legada de una sola `{{1}}`. Exige exactamente los índices del
 * integrador; valida cada valor con la regla de Meta.
 */
export function resolveApiParams(
  t: TemplateShape,
  params: Record<string, string>
): ParamsResolution {
  const vars = publicVariables(t);
  const expected = callerIndexes(vars);
  const given = Object.keys(params);

  const unknown = given.filter((k) => !expected.includes(Number(k)));
  if (unknown.length > 0) {
    return {
      ok: false,
      code: "unknown_params",
      message: `Índices que no debés mandar (el CRM los completa o no existen): ${unknown.join(", ")}`,
      extra: { unknown },
    };
  }
  const missing = expected.filter((i) => !(String(i) in params));
  if (missing.length > 0) {
    return {
      ok: false,
      code: "missing_params",
      message: `Faltan valores para {{${missing.join("}}, {{")}}}`,
      extra: { missing: missing.map(String) },
    };
  }
  for (const index of expected) {
    const invalid = validateParamValue(params[String(index)] ?? "");
    if (invalid) {
      return {
        ok: false,
        code: "invalid_param",
        message: `{{${index}}}: ${invalid}`,
        extra: { index: String(index) },
      };
    }
  }

  if (t.variableBindings !== null && t.variableBindings !== undefined) {
    return {
      ok: true,
      freeTexts: expected.map((i) => params[String(i)]!.trim()),
    };
  }
  const n = countVariables(t.body);
  if (n === 0) return { ok: true };
  if (n === 1) return { ok: true, variable: params["1"]!.trim() };
  return {
    ok: false,
    code: "template_not_supported",
    message:
      "Plantilla anterior con varias variables sin orígenes definidos: recreala desde Ajustes → Plantillas eligiendo el origen de cada variable",
  };
}

/** Listado público: aprobadas por defecto, con su media 1:1 (solo el id). */
export async function listPublicTemplates(
  organizationId: string,
  includeAll: boolean
) {
  const db = getDb();
  const rows = await db
    .select({ template: schema.template, headerMediaId: schema.templateMedia.id })
    .from(schema.template)
    .leftJoin(schema.templateMedia, eq(schema.templateMedia.templateId, schema.template.id))
    .where(
      scoped(
        schema.template.organizationId,
        organizationId,
        includeAll ? undefined : eq(schema.template.status, "approved")
      )
    );
  return rows
    .sort((a, b) => a.template.name.localeCompare(b.template.name))
    .map((r) => serializePublicTemplate(r.template, r.headerMediaId));
}

export type TemplateLookup =
  | { ok: true; template: TemplateRow }
  | {
      ok: false;
      code: "template_not_found" | "language_required";
      message: string;
      extra?: Record<string, unknown>;
    };

/** Plantilla por nombre (+ idioma si el nombre existe en varios). */
export async function findTemplateByName(
  organizationId: string,
  name: string,
  language?: string
): Promise<TemplateLookup> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.template)
    .where(
      scoped(
        schema.template.organizationId,
        organizationId,
        and(
          eq(schema.template.name, name),
          language ? eq(schema.template.language, language) : undefined
        )
      )
    );
  if (rows.length === 0) {
    return {
      ok: false,
      code: "template_not_found",
      message: language
        ? `No existe la plantilla «${name}» en idioma «${language}»`
        : `No existe la plantilla «${name}»`,
    };
  }
  if (rows.length > 1) {
    const languages = rows.map((r) => r.language).sort();
    return {
      ok: false,
      code: "language_required",
      message: `La plantilla «${name}» existe en varios idiomas: indicá \`language\` (${languages.join(", ")})`,
      extra: { languages },
    };
  }
  return { ok: true, template: rows[0]! };
}
