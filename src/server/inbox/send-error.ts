/** Error tipado del envío; `code` mapea a HTTP en la capa de API. */
export class SendError extends Error {
  code:
    | "sandbox_violation"
    | "not_connected"
    | "reconnect_required"
    | "window_closed"
    | "opted_out"
    | "meta_error"
    | "meta_unavailable";
  /**
   * 026: el adjunto YA quedó registrado (como fallido) cuando el proveedor
   * lo rechazó: el cliente suelta el adjunto y ofrece reintentar desde el
   * mensaje en vez de volver a mandarlo.
   */
  messageId?: string;

  constructor(code: SendError["code"], message: string, opts?: { messageId?: string }) {
    super(message);
    this.name = "SendError";
    this.code = code;
    if (opts?.messageId) this.messageId = opts.messageId;
  }
}

/** Código de envío → HTTP (compartido por texto, adjuntos y reintentos). */
export const SEND_ERROR_STATUS: Record<SendError["code"], number> = {
  sandbox_violation: 403,
  not_connected: 409,
  reconnect_required: 409,
  window_closed: 409,
  opted_out: 409,
  meta_error: 422,
  meta_unavailable: 503,
};
