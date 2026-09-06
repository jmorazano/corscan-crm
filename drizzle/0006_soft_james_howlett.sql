CREATE TABLE "appointment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"conversation_id" text,
	"google_event_id" text,
	"calendar_id" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"timezone" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_by" text DEFAULT 'agent' NOT NULL,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text DEFAULT 'google' NOT NULL,
	"account_email" text,
	"calendar_id" text DEFAULT 'primary' NOT NULL,
	"calendar_name" text,
	"timezone" text DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
	"refresh_token_cipher" text NOT NULL,
	"refresh_token_iv" text NOT NULL,
	"refresh_token_tag" text NOT NULL,
	"access_token_cipher" text,
	"access_token_iv" text,
	"access_token_tag" text,
	"access_token_expires_at" timestamp,
	"status" text DEFAULT 'connected' NOT NULL,
	"agent_booking_enabled" boolean DEFAULT true NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"min_lead_hours" integer DEFAULT 2 NOT NULL,
	"horizon_days" integer DEFAULT 14 NOT NULL,
	"weekly_hours" jsonb NOT NULL,
	"booking_instructions" text,
	"connected_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_integration" ADD CONSTRAINT "calendar_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_org_contact_start_uq" ON "appointment" USING btree ("organization_id","contact_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointment_org_starts_idx" ON "appointment" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_integration_org_uq" ON "calendar_integration" USING btree ("organization_id");