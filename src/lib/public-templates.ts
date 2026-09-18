import { originByKey, usedVariableIndexes } from "@/lib/template-body";

/**
 * Vista PÚBLICA de las variables de una plantilla (014, FR-003). Módulo
 * puro y compartido: la API la usa para el listado y la validación de
 * `params`; Ajustes → API la usa para armar los ejemplos `curl` con las
 * plantillas reales de la empresa.
 */

export type TemplateShape = {
  body: string;
  variableBindings: string[] | null | undefined;
};

export type PublicVariable = {
  /** Índice de `{{n}}` en el cuerpo. */
  index: number;
  origin: string;
  /** `crm`: el CRM la completa solo · `caller`: la manda el integrador. */
  provided_by: "crm" | "caller";
  label: string;
  sample: string | null;
};

/**
 * Con orígenes (009): cada binding en su posición. Legada (sin orígenes):
 * cada `{{n}}` es texto libre del integrador.
 */
export function publicVariables(t: TemplateShape): PublicVariable[] {
  const bindings = t.variableBindings ?? null;
  if (bindings !== null) {
    return bindings.map((origin, i) => {
      const meta = originByKey(origin);
      return {
        index: i + 1,
        origin,
        provided_by: origin === "free_text" ? "caller" : "crm",
        label: meta?.label ?? origin,
        sample: meta?.sample ?? null,
      };
    });
  }
  const free = originByKey("free_text");
  return usedVariableIndexes(t.body).map((index) => ({
    index,
    origin: "free_text",
    provided_by: "caller",
    label: free?.label ?? "Texto libre al enviar",
    sample: free?.sample ?? null,
  }));
}

export function callerIndexes(vars: readonly PublicVariable[]): number[] {
  return vars.filter((v) => v.provided_by === "caller").map((v) => v.index);
}

/** `params` de ejemplo: un placeholder por índice del integrador. */
export function exampleParams(
  vars: readonly PublicVariable[],
  placeholder = "…"
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const index of callerIndexes(vars)) params[String(index)] = placeholder;
  return params;
}

/** Comando `curl` listo para pegar (la guía de Ajustes → API). */
export function curlSendExample(input: {
  baseUrl: string;
  template: { name: string; language: string } & TemplateShape;
  key?: string;
}): string {
  const vars = publicVariables(input.template);
  const params: Record<string, string> = {};
  for (const index of callerIndexes(vars)) {
    params[String(index)] = `valor para {{${index}}}`;
  }
  const body = {
    to: "+54 9 351 123 4567",
    name: "Nombre del cliente",
    template: input.template.name,
    language: input.template.language,
    params,
  };
  return [
    `curl -X POST ${input.baseUrl}/api/v1/messages \\`,
    `  -H "Authorization: Bearer ${input.key ?? "vk_TU_CLAVE"}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Idempotency-Key: reserva-123:${input.template.name}" \\`,
    `  -d '${JSON.stringify(body)}'`,
  ].join("\n");
}
