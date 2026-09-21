CREATE TABLE "agent_change" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text,
	"message_id" text,
	"source" text DEFAULT 'trainer' NOT NULL,
	"op" text NOT NULL,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"summary" text NOT NULL,
	"reverted_at" timestamp,
	"reverted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_media" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"message_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_ms" integer,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "message_media_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "ai_credentials" ADD COLUMN "transcription_model" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "kind" text DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_entry" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_change" ADD CONSTRAINT "agent_change_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_change" ADD CONSTRAINT "agent_change_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_change" ADD CONSTRAINT "agent_change_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_media" ADD CONSTRAINT "message_media_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_media" ADD CONSTRAINT "message_media_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_change_org_created_idx" ON "agent_change" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_org_trainer_uq" ON "conversation" USING btree ("organization_id") WHERE "conversation"."kind" = 'trainer';