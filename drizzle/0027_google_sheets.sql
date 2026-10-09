CREATE TABLE IF NOT EXISTS "payment_receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"contact_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"dedup_key" text,
	"spreadsheet_id" text,
	"sheet_title" text,
	"values_cipher" text,
	"values_iv" text,
	"values_tag" text,
	"updated_range" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sheet_source" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"spreadsheet_id" text NOT NULL,
	"spreadsheet_name" text NOT NULL,
	"sheet_title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sheets_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"account_email" text,
	"refresh_token_cipher" text NOT NULL,
	"refresh_token_iv" text NOT NULL,
	"refresh_token_tag" text NOT NULL,
	"access_token_cipher" text,
	"access_token_iv" text,
	"access_token_tag" text,
	"access_token_expires_at" timestamp,
	"status" text DEFAULT 'connected' NOT NULL,
	"receipts_enabled" boolean DEFAULT false NOT NULL,
	"receipts_spreadsheet_id" text,
	"receipts_spreadsheet_name" text,
	"receipts_sheet_title" text,
	"connected_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_receipt" ADD CONSTRAINT "payment_receipt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_receipt" ADD CONSTRAINT "payment_receipt_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_receipt" ADD CONSTRAINT "payment_receipt_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "sheet_source" ADD CONSTRAINT "sheet_source_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "sheets_integration" ADD CONSTRAINT "sheets_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_receipt_message_uq" ON "payment_receipt" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_receipt_org_created_idx" ON "payment_receipt" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_receipt_org_dedup_idx" ON "payment_receipt" USING btree ("organization_id","dedup_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sheet_source_org_sheet_uq" ON "sheet_source" USING btree ("organization_id","spreadsheet_id","sheet_title");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sheets_integration_org_uq" ON "sheets_integration" USING btree ("organization_id");