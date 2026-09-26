/** Utilidades de presentación de la bandeja. */

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function formatRemaining(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const MEDIA_LABELS: Record<string, string> = {
  image: "Imagen",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  sticker: "Sticker",
  location: "Ubicación",
  contacts: "Contacto compartido",
  template: "Plantilla",
  media_placeholder: "Archivo del celular",
  // 023: Instagram Direct.
  share: "Publicación compartida",
  story: "Historia de Instagram",
  unsupported: "Adjunto no disponible",
  deleted: "Mensaje eliminado",
  reaction: "Reacción",
};

export function mediaLabel(type: string): string {
  return MEDIA_LABELS[type] ?? "Contenido";
}

export function previewText(preview: string | null): string {
  if (!preview) return "";
  return MEDIA_LABELS[preview] ? `📎 ${MEDIA_LABELS[preview]}` : preview;
}
