/** DTOs que viajan por la API interna (lado cliente). */

export type ConversationDto = {
  id: string;
  /** 015: `trainer` = la conversación fija del dueño con su propio agente.
   * 023: `instagram` = conversación por Instagram Direct. */
  kind: "whatsapp" | "trainer" | "instagram";
  contact: {
    id: string;
    name: string;
    /** 023: en Instagram es el sintético `ig:<IGSID>`; la UI muestra el @usuario. */
    phone: string;
    channel: "whatsapp" | "instagram";
    igUsername: string | null;
    /** 011: BAJA/STOP registrado — la bandeja lo señaliza. */
    optedOut: boolean;
  };
  stageName: string | null;
  aiEnabled: boolean;
  handoffAt: string | null;
  handoffReason: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  windowOpen: boolean;
  windowRemainingMs: number;
  preview: string | null;
  tags: string[];
};

/** 014: origen externo de un saliente («Enviado por API · <clave>»). */
export type MessageVia = { kind: "api"; label: string };

/** 015: media adjunta (nota de voz); `url` es privada y por tenant. */
export type MessageMediaDto = { url: string; mimeType: string; durationMs: number | null };

export type MessageDto = {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  type: string;
  text: string | null;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  /** 010: motivo crudo del fallo de entrega (texto de Meta), si falló. */
  error: string | null;
  aiGenerated: boolean;
  /** 014: null salvo mensajes originados por la API pública. */
  via: MessageVia | null;
  /** 015: nota de voz adjunta (type="audio"); `text` es la transcripción.
   * 020: también la imagen o el audio que mandó el cliente. */
  media: MessageMediaDto | null;
  /** 020: estado del adjunto, independiente del estado de entrega. NULL =
   * el mensaje no tiene nada que procesar. */
  mediaState: "pending" | "ready" | "failed" | null;
  /** 020: descripción de la imagen generada por IA (nunca texto del cliente). */
  mediaSummary: string | null;
  /** 017: `history` = importado del celular; `phone` = eco de la app del celular. */
  source: "cloud" | "history" | "phone";
  createdAt: string;
};

export type TemplateDto = {
  id: string;
  name: string;
  language: string;
  category: string;
  body: string;
  status: "draft" | "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  /** Ruta del binario del encabezado de imagen (008), o null si no tiene. */
  headerImageUrl: string | null;
  /** 009: origen de cada variable ({{i+1}} ↔ posición i); null = legada. */
  variableBindings: string[] | null;
};

export type StageDto = {
  id: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
};

export type ContactDto = {
  id: string;
  name: string;
  phone: string;
  /** 023: `instagram` = sin teléfono real; se muestra el @usuario. */
  channel: "whatsapp" | "instagram";
  igUsername: string | null;
  notes: string | null;
  tags: string[];
  consentSource: "import" | "inbound" | "manual" | null;
  optedOutAt: string | null;
  isTest: boolean;
  archivedAt: string | null;
};
