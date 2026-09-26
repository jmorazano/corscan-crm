import { Instagram } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Marca del canal de una conversación (023). WhatsApp no tiene ícono en
 * lucide: glifo propio mínimo, en el verde de marca.
 */
export function ChannelIcon({
  channel,
  className,
}: {
  channel: "whatsapp" | "instagram";
  className?: string;
}) {
  if (channel === "instagram") {
    return (
      <Instagram
        aria-label="Instagram"
        className={cn("h-3.5 w-3.5 text-[#d62976]", className)}
        strokeWidth={2}
      />
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label="WhatsApp"
      className={cn("h-3.5 w-3.5 text-[#25D366]", className)}
      fill="currentColor"
    >
      <path d="M12 2a10 10 0 0 0-8.66 15l-1.3 4.74 4.86-1.27A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-2.88.75.77-2.8-.2-.29A8.2 8.2 0 1 1 12 20.2Zm4.5-6.14c-.25-.12-1.46-.72-1.69-.8-.22-.08-.39-.12-.55.12-.16.25-.63.8-.77.96-.14.17-.28.19-.53.06a6.7 6.7 0 0 1-1.97-1.22 7.4 7.4 0 0 1-1.37-1.7c-.14-.25 0-.38.11-.5l.37-.43c.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.3 2.74 2.74 0 0 0-.86 2.04 4.76 4.76 0 0 0 1 2.53 10.9 10.9 0 0 0 4.18 3.7c.58.25 1.04.4 1.4.51.58.19 1.12.16 1.54.1.47-.07 1.46-.6 1.66-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}
