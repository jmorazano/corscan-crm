import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
    notes: text("notes"),
    /** Etiquetas de segmentación (004): saneadas (trim, lower, únicas). */
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** Consentimiento (004): NULL = sin registro → inelegible para campañas. */
    consentSource: text("consent_source", {
      enum: ["import", "inbound", "manual"],
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
    /** Conversación del Laboratorio: jamás toca la API de WhatsApp. */
    isTest: boolean("is_test").notNull().default(false),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    handoffAt: timestamp("handoff_at"),
    handoffReason: text("handoff_reason", {
      enum: ["cliente", "modelo", "error", "ventana"],
    }),
    lastInboundAt: timestamp("last_inbound_at"),
    lastMessageAt: timestamp("last_message_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Una conversación real por contacto; las de prueba no compiten.
    uniqueIndex("conversation_org_contact_real_uq")
      .on(t.organizationId, t.contactId)
      .where(sql`${t.isTest} = false`),
    index("conversation_org_last_idx").on(t.organizationId, t.lastMessageAt),
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
    text: text("text"),
    status: text("status", {
      enum: ["pending", "sent", "delivered", "read", "failed"],
    })
      .notNull()
      .default("pending"),
    error: text("error"),
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("kb_org_idx").on(t.organizationId)]
);

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
