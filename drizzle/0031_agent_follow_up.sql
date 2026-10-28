CREATE TABLE IF NOT EXISTS "agent_follow_up" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"cycle_message_id" text NOT NULL,
	"step" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"text" text,
	"source" text,
	"message_id" text,
	"stage_kind" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"replied_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "follow_up_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "follow_up_timezone" text DEFAULT 'America/Argentina/Cordoba' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "follow_up_start_hour" integer DEFAULT 9 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "follow_up_end_hour" integer DEFAULT 21 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "follow_up_text_1" text;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "follow_up_text_2" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "opted_out_source" text;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "agent_follow_up" ADD CONSTRAINT "agent_follow_up_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "agent_follow_up" ADD CONSTRAINT "agent_follow_up_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "agent_follow_up" ADD CONSTRAINT "agent_follow_up_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_follow_up_cycle_uq" ON "agent_follow_up" USING btree ("conversation_id","cycle_message_id","step");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_follow_up_org_created_idx" ON "agent_follow_up" USING btree ("organization_id","created_at");