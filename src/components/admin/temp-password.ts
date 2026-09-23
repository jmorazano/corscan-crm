/**
 * Generador de contraseña temporal (D7 de 003): nace en el cliente y el
 * server jamás la devuelve — se muestra UNA sola vez. Compartido por el
 * alta de empresa, el alta de usuario y el reset.
 */
export function generateTempPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
