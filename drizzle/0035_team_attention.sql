CREATE TABLE IF NOT EXISTS "attention_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"alert_enabled" boolean DEFAULT false NOT NULL,
	"alert_minutes" integer DEFAULT 15 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attention_wait" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"start_reason" text NOT NULL,
	"start_message_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp,
	"responder_user_id" text,
	"responder_name" text,
	"responder_via" text,
	"response_ms" integer,
	"alerted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "sent_by_name" text;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "attention_settings" ADD CONSTRAINT "attention_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "attention_wait" ADD CONSTRAINT "attention_wait_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "attention_wait" ADD CONSTRAINT "attention_wait_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "attention_wait" ADD CONSTRAINT "attention_wait_start_message_id_message_id_fk" FOREIGN KEY ("start_message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "attention_wait" ADD CONSTRAINT "attention_wait_responder_user_id_user_id_fk" FOREIGN KEY ("responder_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attention_settings_org_uq" ON "attention_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attention_wait_open_uq" ON "attention_wait" USING btree ("conversation_id") WHERE "attention_wait"."status" = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attention_wait_org_started_idx" ON "attention_wait" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attention_wait_open_idx" ON "attention_wait" USING btree ("status","started_at") WHERE "attention_wait"."status" = 'open';--> statement-breakpoint
-- 048: firma del hilo para los mensajes que ya tenían autor (re-ejecutable).
UPDATE "message" m SET "sent_by_name" = u."name" FROM "user" u WHERE m."sent_by_user_id" = u."id" AND m."sent_by_name" IS NULL;
