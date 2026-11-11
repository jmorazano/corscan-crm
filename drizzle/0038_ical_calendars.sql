CREATE TABLE IF NOT EXISTS "ical_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_enabled" boolean DEFAULT true NOT NULL,
	"booking_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ical_unit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"description" text,
	"booking_url" text,
	"ical_url_cipher" text NOT NULL,
	"ical_url_iv" text NOT NULL,
	"ical_url_tag" text NOT NULL,
	"listing_id" text NOT NULL,
	"feed_host" text NOT NULL,
	"token_last4" text,
	"position" integer DEFAULT 0 NOT NULL,
	"busy_ranges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"horizon_to" text,
	"fetched_at" timestamp,
	"last_ok_at" timestamp,
	"last_error" text,
	"content_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ical_integration" ADD CONSTRAINT "ical_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ical_unit" ADD CONSTRAINT "ical_unit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ical_integration_org_uq" ON "ical_integration" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ical_unit_org_listing_uq" ON "ical_unit" USING btree ("organization_id","listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ical_unit_org_position_idx" ON "ical_unit" USING btree ("organization_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ical_unit_fetched_idx" ON "ical_unit" USING btree ("fetched_at");