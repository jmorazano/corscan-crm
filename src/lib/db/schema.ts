import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** bytea de Postgres (drizzle no lo trae de fábrica). Driver postgres.js:
 * escribe/lee Buffer directamente. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/* ============================================================
 * Auth (Better Auth + plugin organization)
 * ============================================================ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** Contraseña temporal vigente (FR-017): toda alta por tercero y todo
   * reset lo setean; el cambio de contraseña propio lo limpia. */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  /** 018: última empresa usada (se restaura al iniciar sesión si el usuario
   * sigue siendo miembro). Sin FK: si la empresa se borra, se ignora. */
  lastOrganizationId: text("last_organization_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  metadata: text("metadata"),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  // 018: un usuario puede ser miembro de VARIAS empresas, pero una sola
  // vez de cada una (sumar una cuenta existente es idempotente).
  (t) => [uniqueIndex("member_org_user_uq").on(t.organizationId, t.userId)]
);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

/* ============================================================
 * Dominio (toda tabla lleva organization_id NOT NULL + índice org-first)
 * ============================================================ */

export const contact = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    name: text("name").notNull(),
    /**
     * 021: cuándo una PERSONA del equipo editó el nombre a mano en el CRM.
     * NULL = nadie lo tocó, así que el nombre es el del perfil de WhatsApp
     * (lo eligió el cliente) y se puede reemplazar por uno mejor: el de la
     * agenda del celular (017) o el que el huésped dice en el chat (021).
     * Tapa un agujero de 017: `consent_source` sigue diciendo 'inbound'
     * aunque el operador haya corregido el nombre, y la sync se lo pisaba.
     */
    nameEditedAt: timestamp("name_edited_at"),
    notes: text("notes"),
    /** Etiquetas de segmentación (004): saneadas (trim, lower, únicas). */
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** Consentimiento (004): NULL = sin registro → inelegible para campañas.
     * `api` (014): declarado por el sistema integrador al enviar por API. */
    consentSource: text("consent_source", {
      enum: ["import", "inbound", "manual", "api"],
    }),
    consentAt: timestamp("consent_at"),
    /** Baja (004): set-si-null desde la ingesta (BAJA/STOP); excluye de todo
     * envío iniciado por la empresa. Reversión solo explícita, auditada. */
    optedOutAt: timestamp("opted_out_at"),
    optOutRevertedAt: timestamp("opt_out_reverted_at"),
    optOutRevertedBy: text("opt_out_reverted_by"),
    /** Contacto del Laboratorio (004): jamás elegible para envíos reales ni
     * desarchivable; la migración marca los preexistentes por sus
     * conversaciones is_test. */
    isTest: boolean("is_test").notNull().default(false),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_org_phone_uq").on(t.organizationId, t.phone),
    index("contact_org_name_idx").on(t.organizationId, t.name),
    index("contact_tags_gin_idx").using("gin", t.tags),
  ]
);

export const pipelineStage = pgTable(
  "pipeline_stage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    /** open = etapa normal · won / lost = anclas no borrables */
    kind: text("kind", { enum: ["open", "won", "lost"] })
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("stage_org_pos_idx").on(t.organizationId, t.position)]
);

export const lead = pgTable(
  "lead",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    stageId: text("stage_id")
      .notNull()
      .references(() => pipelineStage.id),
    position: integer("position").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_contact_uq").on(t.contactId),
    index("lead_org_stage_idx").on(t.organizationId, t.stageId, t.position),
  ]
);

export const conversation = pgTable(
  "conversation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    /** Sandbox (Laboratorio o entrenador, 015): jamás toca la API de WhatsApp. */
    isTest: boolean("is_test").notNull().default(false),
    /**
     * 015: `whatsapp` = conversación real con un contacto; `trainer` = la
     * conversación fija del dueño con su propio agente (una por empresa,
     * contacto sintético, is_test). Ramifica UI, envío y turno.
     */
    kind: text("kind", { enum: ["whatsapp", "trainer"] })
      .notNull()
      .default("whatsapp"),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    handoffAt: timestamp("handoff_at"),
    handoffReason: text("handoff_reason", {
      enum: ["cliente", "modelo", "error", "ventana"],
    }),
    lastInboundAt: timestamp("last_inbound_at"),
    lastMessageAt: timestamp("last_message_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    /** Etiquetas de triage de la conversación (006): saneadas como las del
     * contacto pero independientes de ellas (el contacto segmenta campañas;
     * la conversación organiza el trabajo del día). */
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Una conversación real por contacto; las de prueba no compiten.
    uniqueIndex("conversation_org_contact_real_uq")
      .on(t.organizationId, t.contactId)
      .where(sql`${t.isTest} = false`),
    // 015: una sola conversación del entrenador por empresa.
    uniqueIndex("conversation_org_trainer_uq")
      .on(t.organizationId)
      .where(sql`${t.kind} = 'trainer'`),
    index("conversation_org_last_idx").on(t.organizationId, t.lastMessageAt),
    index("conversation_tags_gin_idx").using("gin", t.tags),
  ]
);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    /**
     * ID de WhatsApp — UNIQUE por (organization_id, wa_message_id): la
     * idempotencia de la ingesta es POR TENANT (US2). Con el unique global,
     * un wamid ya persistido en la org A tragaba en silencio el mensaje
     * homónimo de la org B (wa-mock, importaciones, ecos de coexistence).
     * Nullable en salientes de prueba.
     */
    waMessageId: text("wa_message_id"),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    type: text("type").notNull().default("text"),
    /** Plantilla enviada (004): habilita el dedup de reintentos (FR-009) y
     * el tracking por campaña. Sin FK: la plantilla puede borrarse. */
    templateId: text("template_id"),
    /** Clave de API que originó el saliente (014). Sin FK: la clave revocada
     * conserva su fila y el hilo sigue mostrando «Enviado por API · nombre». */
    apiKeyId: text("api_key_id"),
    /** 017: `cloud` = Cloud API (normal); `history` = importado del historial
     * del celular (coexistence); `phone` = eco de lo que el negocio mandó
     * desde la app del celular. */
    source: text("source", { enum: ["cloud", "history", "phone"] })
      .notNull()
      .default("cloud"),
    text: text("text"),
    status: text("status", {
      enum: ["pending", "sent", "delivered", "read", "failed"],
    })
      .notNull()
      .default("pending"),
    error: text("error"),
    /**
     * 020: estado del ADJUNTO, separado del estado de entrega (`status`).
     * NULL = el mensaje no tiene adjunto que procesar. Un mensaje entrante
     * ya nace `delivered`; sin esta columna el estado de la transcripción
     * pisaba el de entrega, que leen el push, los ticks y la bandeja.
     */
    mediaState: text("media_state", { enum: ["pending", "ready", "failed"] }),
    /**
     * 020: descripción de la imagen GENERADA POR IA. Deliberadamente fuera
     * de `text`: el texto es lo que escribió (o dijo) la persona, y una
     * descripción no lo es. La transcripción de un audio SÍ va en `text`.
     */
    mediaSummary: text("media_summary"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    waTimestamp: timestamp("wa_timestamp"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("message_org_conv_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt
    ),
    // Dedup de ingesta por tenant (los NULL de salientes de prueba no chocan).
    uniqueIndex("message_org_wamid_uq").on(t.organizationId, t.waMessageId),
  ]
);

export const metaCredentials = pgTable(
  "meta_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    wabaId: text("waba_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    displayPhoneNumber: text("display_phone_number"),
    verifiedName: text("verified_name"),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("meta_credentials_org_uq").on(t.organizationId),
    // El webhook enruta por phone_number_id: debe ser único en la instancia.
    uniqueIndex("meta_credentials_phone_uq").on(t.phoneNumberId),
  ]
);

/**
 * Config de IA por empresa (US3, data-model 003): token del proveedor LLM
 * cifrado en reposo (AES-256-GCM) + modelos opcionales (NULL = default de
 * producto). A lo sumo UNA config por organización.
 */
export const aiCredentials = pgTable(
  "ai_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    tokenCipher: text("token_cipher").notNull(),
    tokenIv: text("token_iv").notNull(),
    tokenTag: text("token_tag").notNull(),
    /** Modelo del agente; NULL = default de producto. */
    model: text("model"),
    /** Modelo del juez del Laboratorio; NULL = default (o el del agente). */
    judgeModel: text("judge_model"),
    /** 015: modelo con entrada de audio para transcribir notas de voz del
     * entrenador; NULL = default de producto (nunca el del agente: puede no
     * aceptar audio). */
    transcriptionModel: text("transcription_model"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_credentials_org_uq").on(t.organizationId)]
);

export const agentProfile = pgTable(
  "agent_profile",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    name: text("name").notNull().default("Asistente"),
    tone: text("tone"),
    instructions: text("instructions"),
    escalationRules: text("escalation_rules"),
    greeting: text("greeting"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_profile_org_uq").on(t.organizationId)]
);

export const kbEntry = pgTable(
  "kb_entry",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["qa", "block"] }).notNull(),
    question: text("question"),
    answer: text("answer"),
    content: text("content"),
    /** 015: origen de la entrada (chip en Agente): manual, sugerencia del
     * Laboratorio o enseñanza por chat del entrenador. */
    source: text("source", { enum: ["manual", "lab", "trainer"] })
      .notNull()
      .default("manual"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("kb_org_idx").on(t.organizationId)]
);

/**
 * Auditoría de cambios del agente (015): cada alta/edición/baja del
 * conocimiento o del perfil aplicada por el entrenador, con el estado
 * anterior y posterior para poder deshacerla. `message_id` apunta a la
 * respuesta del agente que la reportó (sin cascade: borrar el hilo no borra
 * la auditoría).
 */
export const agentChange = pgTable(
  "agent_change",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    messageId: text("message_id").references(() => message.id, {
      onDelete: "set null",
    }),
    source: text("source", { enum: ["trainer", "manual", "lab"] })
      .notNull()
      .default("trainer"),
    op: text("op", {
      enum: ["kb_add", "kb_update", "kb_delete", "profile_update"],
    }).notNull(),
    /** id de kb_entry, o nombre del campo del perfil. */
    targetId: text("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    summary: text("summary").notNull(),
    revertedAt: timestamp("reverted_at"),
    revertedBy: text("reverted_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("agent_change_org_created_idx").on(t.organizationId, t.createdAt)]
);

/**
 * Media adjunta a un mensaje (015, notas de voz del entrenador). 1:1 con el
 * mensaje; se sirve SOLO autenticada y por tenant en /api/message-media/{id}
 * (a diferencia de template_media, que Meta descarga sin auth).
 */
export const messageMedia = pgTable("message_media", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  messageId: text("message_id")
    .notNull()
    .unique()
    .references(() => message.id, { onDelete: "cascade" }),
  /** Normalizado, sin `;codecs=` (audio/mp4, audio/ogg, audio/wav…). */
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  durationMs: integer("duration_ms"),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const template = pgTable(
  "template",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category").notNull(),
    body: text("body").notNull(),
    status: text("status", {
      enum: ["draft", "pending", "approved", "rejected"],
    })
      .notNull()
      .default("draft"),
    rejectionReason: text("rejection_reason"),
    waTemplateId: text("wa_template_id"),
    /** 009: origen de cada variable ({{i+1}} ↔ posición i). NULL = plantilla
     * anterior a la feature: conserva el flujo legado completo. */
    variableBindings: jsonb("variable_bindings").$type<string[] | null>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("template_org_name_lang_uq").on(
      t.organizationId,
      t.name,
      t.language
    ),
  ]
);

/**
 * Imagen de encabezado de una plantilla (008). 1:1 real (template_id UNIQUE):
 * borrar la plantilla arrastra su binario por cascade. El id (tm_…) es el
 * segmento público no adivinable de /api/template-media/{id} — la ruta sirve
 * el binario sin auth porque Meta lo descarga en cada envío.
 */
export const templateMedia = pgTable("template_media", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  templateId: text("template_id")
    .notNull()
    .unique()
    .references(() => template.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  byteSize: integer("byte_size").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const agentTestRun = pgTable(
  "agent_test_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["running", "done", "failed"] })
      .notNull()
      .default("running"),
    score: integer("score"),
    error: text("error"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    // Lock de concurrencia en BD: máximo 1 corrida activa por organización.
    uniqueIndex("test_run_org_running_uq")
      .on(t.organizationId)
      .where(sql`${t.status} = 'running'`),
    index("test_run_org_idx").on(t.organizationId, t.startedAt),
  ]
);

export const agentTestCase = pgTable(
  "agent_test_case",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentTestRun.id, { onDelete: "cascade" }),
    persona: text("persona").notNull(),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    transcript: jsonb("transcript"),
    veredicto: text("veredicto", { enum: ["verde", "amarillo", "rojo"] }),
    hallazgos: jsonb("hallazgos"),
    status: text("status", {
      enum: ["pending", "running", "done", "judge_failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("test_case_run_idx").on(t.runId)]
);

/* ============================================================
 * Campañas (feature 004): envío de plantillas con consentimiento,
 * cupo por ventana móvil de 24h y estado por destinatario.
 * ============================================================ */

export const campaign = pgTable(
  "campaign",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** NULL cuando la plantilla se borró (solo posible con la campaña ya
     * terminada); `templateName` conserva el nombre para el historial. */
    templateId: text("template_id").references(() => template.id, {
      onDelete: "set null",
    }),
    templateName: text("template_name"),
    /** Vacío = todos los elegibles; si no, contactos con AL MENOS una. */
    tagFilter: text("tag_filter").array().notNull().default(sql`'{}'::text[]`),
    variableMode: text("variable_mode", {
      enum: ["contact_name", "fixed"],
    })
      .notNull()
      .default("contact_name"),
    variableText: text("variable_text"),
    /** 009: textos libres congelados al crear la campaña (uno por binding
     * free_text de la plantilla, en orden). NULL en campañas legadas. */
    variableValues: jsonb("variable_values").$type<string[] | null>(),
    /** Transiciones finales con guard WHERE (monotónicas, patrón lab). */
    status: text("status", {
      enum: ["draft", "running", "paused", "completed", "cancelled"],
    })
      .notNull()
      .default("draft"),
    pausedReason: text("paused_reason", {
      enum: ["manual", "daily_limit", "channel", "error"],
    }),
    /** Anti doble-runner (004): pause/resume la incrementa; un runner cuya
     * generación ya no coincide se auto-termina (deploys con solape incl.). */
    runnerGeneration: integer("runner_generation").notNull().default(0),
    launchedAt: timestamp("launched_at"),
    completedAt: timestamp("completed_at"),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("campaign_org_created_idx").on(t.organizationId, t.createdAt)]
);

export const campaignRecipient = pgTable(
  "campaign_recipient",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    /**
     * Fuente de verdad anti-duplicados: `sending` CON wa_message_id = ya
     * enviado (el revive lo promueve a sent); SIN wamid = re-intentable.
     * Entregado/leído NO viven acá: derivan de message.status por JOIN.
     */
    status: text("status", {
      enum: ["pending", "sending", "sent", "failed", "skipped"],
    })
      .notNull()
      .default("pending"),
    skipReason: text("skip_reason", {
      enum: ["opted_out", "ineligible", "cancelled"],
    }),
    error: text("error"),
    conversationId: text("conversation_id").references(() => conversation.id),
    messageId: text("message_id").references(() => message.id),
    waMessageId: text("wa_message_id"),
    sentAt: timestamp("sent_at"),
    repliedAt: timestamp("replied_at"),
  },
  (t) => [
    uniqueIndex("campaign_recipient_uq").on(t.campaignId, t.contactId),
    index("campaign_recipient_org_campaign_status_idx").on(
      t.organizationId,
      t.campaignId,
      t.status
    ),
    // Side-effects de la ingesta (respondió / opt-out) buscan por contacto.
    index("campaign_recipient_org_contact_idx").on(
      t.organizationId,
      t.contactId
    ),
  ]
);

/**
 * Registro de iniciaciones (cupo FR-015): una fila por plantilla enviada con
 * ventana de servicio cerrada. Cupo usado = contactos ÚNICOS en las últimas
 * 24h móviles (semántica oficial de Meta, research D4).
 */
export const initiatedSend = pgTable(
  "initiated_send",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
  },
  (t) => [index("initiated_send_org_sent_idx").on(t.organizationId, t.sentAt)]
);

/**
 * Importación del historial del celular (017, coexistence): UNA fila por
 * empresa con el estado de la sincronización pedida a Meta y sus contadores.
 */
export const historyImport = pgTable("history_import", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["idle", "requested", "receiving", "done", "failed", "declined"],
  })
    .notNull()
    .default("idle"),
  /** Ventana que se conserva al ingerir (Meta manda hasta 180). */
  days: integer("days").notNull().default(60),
  requestId: text("request_id"),
  requestedAt: timestamp("requested_at"),
  lastChunkAt: timestamp("last_chunk_at"),
  finishedAt: timestamp("finished_at"),
  progress: integer("progress").notNull().default(0),
  importedMessages: integer("imported_messages").notNull().default(0),
  skippedOld: integer("skipped_old").notNull().default(0),
  threads: integer("threads").notNull().default(0),
  lastErrorCode: text("last_error_code"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const sendSettings = pgTable(
  "send_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Freno del CRM, no el límite real de Meta (tier). Default: 250. */
    dailyInitiatedLimit: integer("daily_initiated_limit").notNull().default(250),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("send_settings_org_uq").on(t.organizationId)]
);

/* ============================================================
 * Integraciones (feature 005): Google Calendar por empresa + turnos.
 * ============================================================ */

/**
 * Conexión de calendario POR EMPRESA (data-model 005): refresh token
 * cifrado (AES-256-GCM), caché cifrada del access token, calendario destino
 * y reglas de turnos. A lo sumo UNA por organización.
 */
export const calendarIntegration = pgTable(
  "calendar_integration",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["google"] }).notNull().default("google"),
    accountEmail: text("account_email"),
    calendarId: text("calendar_id").notNull().default("primary"),
    calendarName: text("calendar_name"),
    timezone: text("timezone")
      .notNull()
      .default("America/Argentina/Buenos_Aires"),
    refreshTokenCipher: text("refresh_token_cipher").notNull(),
    refreshTokenIv: text("refresh_token_iv").notNull(),
    refreshTokenTag: text("refresh_token_tag").notNull(),
    accessTokenCipher: text("access_token_cipher"),
    accessTokenIv: text("access_token_iv"),
    accessTokenTag: text("access_token_tag"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    /** reconnect_required: refresh rechazado (invalid_grant) — research D9. */
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    agentBookingEnabled: boolean("agent_booking_enabled").notNull().default(true),
    slotMinutes: integer("slot_minutes").notNull().default(30),
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    minLeadHours: integer("min_lead_hours").notNull().default(2),
    horizonDays: integer("horizon_days").notNull().default(14),
    /** { "0".."6": [["HH:MM","HH:MM"], …] } — 0 = domingo. */
    weeklyHours: jsonb("weekly_hours").notNull(),
    bookingInstructions: text("booking_instructions"),
    connectedBy: text("connected_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calendar_integration_org_uq").on(t.organizationId)]
);

/**
 * Turno registrado en el CRM (data-model 005). UNIQUE (org, contacto,
 * inicio) = idempotencia de la acción del agente (FR-012).
 */
export const appointment = pgTable(
  "appointment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    googleEventId: text("google_event_id"),
    calendarId: text("calendar_id").notNull(),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    timezone: text("timezone").notNull(),
    title: text("title").notNull(),
    note: text("note"),
    status: text("status", { enum: ["confirmed", "cancelled"] })
      .notNull()
      .default("confirmed"),
    createdBy: text("created_by", { enum: ["agent", "user"] })
      .notNull()
      .default("agent"),
    cancelledAt: timestamp("cancelled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("appointment_org_contact_start_uq").on(
      t.organizationId,
      t.contactId,
      t.startsAt
    ),
    index("appointment_org_starts_idx").on(t.organizationId, t.startsAt),
  ]
);

/* ============================================================
 * Web Push (013): claves VAPID por empresa + suscripciones por dispositivo
 * ============================================================ */

/** Claves VAPID de la empresa (generadas al primer uso). La privada va
 * cifrada con lib/crypto (AES-256-GCM) y jamás sale al cliente. */
export const pushVapidKey = pgTable("push_vapid_key", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(),
  privateKey: jsonb("private_key")
    .$type<{ cipher: string; iv: string; tag: string }>()
    .notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Un dispositivo (navegador) suscripto, ligado a la empresa activa al
 * activarlo y al usuario. `endpoint` es único: re-activar re-liga. */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** `all`: todo entrante · `handoff`: solo atención humana (FR-005). */
    mode: text("mode", { enum: ["all", "handoff"] })
      .notNull()
      .default("all"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
  },
  (t) => [
    uniqueIndex("push_subscription_endpoint_uq").on(t.endpoint),
    index("push_subscription_org_user_idx").on(t.organizationId, t.userId),
  ]
);

/* ============================================================
 * API pública (014): claves por empresa + idempotencia de envíos
 * ============================================================ */

/**
 * Clave de API POR EMPRESA (014, data-model). En reposo solo el hash
 * SHA-256 de la clave completa (256 bits de entropía: se busca por hash,
 * índice único) y un prefijo visible para identificarla. Revocar es soft
 * delete: la fila queda para que el hilo siga mostrando quién envió.
 */
export const apiKey = pgTable(
  "api_key",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [
    uniqueIndex("api_key_hash_uq").on(t.keyHash),
    index("api_key_org_idx").on(t.organizationId, t.createdAt),
  ]
);

/**
 * Idempotencia de `POST /api/v1/messages` (014, D2): reserva-primero.
 * `status_code = 0` = en curso; con respuesta = replay. Solo se conserva si
 * el mensaje se creó; ante error se borra para que el cliente reintente.
 */
export const apiRequest = pgTable(
  "api_request",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    apiKeyId: text("api_key_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull().default(0),
    responseBody: jsonb("response_body").$type<Record<string, unknown> | null>(),
    messageId: text("message_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_request_org_key_uq").on(t.organizationId, t.idempotencyKey),
  ]
);

/* ============================================================
 * Conector MCP por empresa (016): servidor Model Context Protocol
 * remoto de SOLO LECTURA (JSON-RPC 2.0 sobre HTTP). Transporte
 * genérico + perfil por proveedor (Constitución II, categoría 5).
 * ============================================================ */

/**
 * Conexión MCP POR EMPRESA (data-model 016) — patrón calcado de
 * calendar_integration: credencial cifrada en reposo (AES-256-GCM), a la UI
 * solo viaja lo visible (host, perfil, estado, catálogo), todo acceso
 * scoped. A lo sumo UNA por organización. La habilita el SUPER ADMIN: la
 * fila EXISTE aunque no haya credencial (`status='enabled'`), y esa
 * existencia ES la habilitación que hace aparecer la tarjeta (FR-001).
 */
export const mcpIntegration = pgTable(
  "mcp_integration",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Perfil que sabe leer las herramientas del proveedor y renderizar
     * precios y enlaces. `generic` = sin herramientas para el agente: un
     * servidor sin perfil conocido se conecta y se diagnostica, pero NO se
     * le ofrece al modelo (FR-007).
     */
    profile: text("profile", { enum: ["generic", "altos_de_calamuchita"] })
      .notNull()
      .default("generic"),
    /** Nombre visible en la tarjeta y en el prompt del agente. */
    label: text("label").notNull(),
    /**
     * Endpoint JSON-RPC. Lo escribe SOLO el super admin (FR-001/FR-002);
     * validado anti-SSRF al guardar y RE-validado sobre la IP resuelta en
     * cada conexión (FR-003).
     */
    endpointUrl: text("endpoint_url").notNull(),
    authScheme: text("auth_scheme", { enum: ["bearer", "api_key_header"] })
      .notNull()
      .default("bearer"),
    /**
     * Credencial cifrada (AES-256-GCM, lib/crypto). Columna jsonb única y no
     * la terna cipher/iv/tag porque acá el secreto es nullable EN BLOQUE:
     * con tres columnas hay que mantener tres NULL sincronizados. Precedente:
     * push_vapid_key.privateKey (013). NULL = habilitada sin conectar
     * (initialize y tools/list andan igual; tools/call no) — FR-004.
     */
    credential: jsonb("credential").$type<{
      cipher: string;
      iv: string;
      tag: string;
    } | null>(),
    /** Últimos 4, único fragmento que ve la UI (Constitución I). */
    credentialLast4: text("credential_last4"),
    /**
     * enabled = habilitada sin credencial válida · connected = handshake OK ·
     * reconnect_required = el servidor devolvió unauthorized ·
     * disabled = apagada sin perder catálogo ni historial.
     */
    status: text("status", {
      enum: ["enabled", "connected", "reconnect_required", "disabled"],
    })
      .notNull()
      .default("enabled"),
    /**
     * stateless = tools/call directo · initialize = handshake previo y
     * Mcp-Session-Id en cada llamada. Lo decide el handshake, no una
     * suposición: el MCP de Altos resultó stateless (research D1).
     */
    sessionMode: text("session_mode", { enum: ["stateless", "initialize"] })
      .notNull()
      .default("stateless"),
    serverName: text("server_name"),
    serverVersion: text("server_version"),
    protocolVersion: text("protocol_version"),
    /**
     * `instructions` del initialize. DATO del proveedor: va al prompt
     * delimitado, saneado y truncado, jamás como regla (FR-011).
     */
    instructions: text("instructions"),
    /** Opt-IN explícito a las instrucciones del servidor (corrección de seguridad). */
    useServerInstructions: boolean("use_server_instructions")
      .notNull()
      .default(false),
    /** tools/list congelado en el último handshake (nombre + descripción). */
    tools: jsonb("tools").$type<
      { name: string; description: string | null; readOnly: boolean }[] | null
    >(),
    lastHandshakeAt: timestamp("last_handshake_at"),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: timestamp("last_error_at"),
    /** Prefetch del catálogo (list-search-options) que va al system prompt. */
    catalog: jsonb("catalog").$type<Record<string, unknown> | null>(),
    catalogFetchedAt: timestamp("catalog_fetched_at"),
    catalogTtlMinutes: integer("catalog_ttl_minutes").notNull().default(60),
    /**
     * Zona horaria del negocio del proveedor: sin esto, en UTC y después de
     * las 21 h de Córdoba, "mañana" resuelve un día de más — justo el prime
     * time de WhatsApp para cabañas.
     */
    timezone: text("timezone").notNull().default("America/Argentina/Cordoba"),
    /** El agente puede llamar herramientas (independiente de estar conectada). */
    agentToolsEnabled: boolean("agent_tools_enabled").notNull().default(true),
    /**
     * Deadline y tope de respuesta POR EMPRESA: el servidor lo opera el
     * cliente y su latencia no es nuestra.
     */
    timeoutMs: integer("timeout_ms").notNull().default(10000),
    maxResponseBytes: integer("max_response_bytes").notNull().default(524288),
    enabledBy: text("enabled_by"),
    enabledAt: timestamp("enabled_at").notNull().defaultNow(),
    connectedBy: text("connected_by"),
    connectedAt: timestamp("connected_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mcp_integration_org_uq").on(t.organizationId)]
);

/**
 * Bitácora de llamadas al MCP (016): diagnóstico y EVIDENCIA del sandbox.
 * No es idempotencia tipo webhook (Principio IV rige lo ENTRANTE): lo
 * saliente se reintenta y su resultado cambia con el tiempo, por eso NO hay
 * unique sobre args_hash. `is_test` marca las simuladas del Laboratorio:
 * esas JAMÁS salieron a la red, y con una query se demuestra (SC-003).
 */
export const mcpToolCall = pgTable(
  "mcp_tool_call",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    integrationId: text("integration_id")
      .notNull()
      .references(() => mcpIntegration.id, { onDelete: "cascade" }),
    /** set null al borrar el hilo: la métrica sobrevive (patrón agent_change). */
    conversationId: text("conversation_id").references(() => conversation.id, {
      onDelete: "set null",
    }),
    tool: text("tool").notNull(),
    /** SHA-256 de los argumentos normalizados (node:crypto). */
    argsHash: text("args_hash").notNull(),
    /** Argumentos enviados. JAMÁS la credencial. */
    args: jsonb("args").$type<Record<string, unknown>>(),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    /**
     * Código estable del proveedor (unknown_city…) o nuestro de transporte
     * (timeout, too_large, blocked_host, bad_payload, unauthorized).
     */
    errorCode: text("error_code"),
    /** Texto propio ya redactado y truncado: nunca el del tercero (FR-016). */
    errorMessage: text("error_message"),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms"),
    responseBytes: integer("response_bytes"),
    isTest: boolean("is_test").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("mcp_tool_call_org_created_idx").on(t.organizationId, t.createdAt),
    index("mcp_tool_call_org_conv_idx").on(
      t.organizationId,
      t.conversationId,
      t.createdAt
    ),
  ]
);
