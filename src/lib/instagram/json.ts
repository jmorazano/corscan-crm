/**
 * JSON de Meta sin perder IDs (023). Los IDs de Instagram tienen 17 dígitos
 * (`17841400000000001`) y superan `Number.MAX_SAFE_INTEGER`: si Meta los
 * manda como NÚMERO, `JSON.parse` los redondea en silencio y el webhook
 * enruta a una cuenta que no existe. Antes de parsear, todo entero de 16+
 * dígitos en una clave que termina en `id` se convierte en texto.
 */
export function parseMetaJson(text: string): unknown {
  return JSON.parse(
    text.replace(/("[A-Za-z_]*id"\s*:\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"')
  );
}
