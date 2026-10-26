CREATE TABLE IF NOT EXISTS "assistant_access_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"grant_id" text,
	"user_id" text,
	"client_label" text NOT NULL,
	"tool" text NOT NULL,
	"summary" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_auth_code" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_ids" text[] NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"grant_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_client" (
	"id" text PRIMARY KEY NOT NULL,
	"client_name" text,
	"redirect_uris" text[] NOT NULL,
	"software_id" text,
	"software_version" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_authorized_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"client_label" text NOT NULL,
	"scope" text DEFAULT 'crm.read' NOT NULL,
	"resource" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revoked_reason" text,
	"revoked_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_grant_org" (
	"organization_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_grant_org_grant_id_organization_id_pk" PRIMARY KEY("grant_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by_user_id" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_token" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "assistant_access_log" ADD CONSTRAINT "assistant_access_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "assistant_access_log" ADD CONSTRAINT "assistant_access_log_grant_id_assistant_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."assistant_grant"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "assistant_access_log" ADD CONSTRAINT "assistant_access_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "assistant_auth_code" ADD CONSTRAINT "assistant_auth_code_client_id_assistant_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."assistant_client"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "assistant_auth_code" ADD CONSTRAINT "assistant_auth_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "assistant_grant" ADD CONSTRAINT "assistant_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "assistant_grant" ADD CONSTRAINT "assistant_grant_client_id_assistant_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."assistant_client"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "assistant_grant" ADD CONSTRAINT "assistant_grant_revoked_by_user_id_user_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "assistant_grant_org" ADD CONSTRAINT "assistant_grant_org_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "assistant_grant_org" ADD CONSTRAINT "assistant_grant_org_grant_id_assistant_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."assistant_grant"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "assistant_token" ADD CONSTRAINT "assistant_token_grant_id_assistant_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."assistant_grant"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_access_log_org_created_idx" ON "assistant_access_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_grant_user_status_idx" ON "assistant_grant" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_grant_org_org_idx" ON "assistant_grant_org" USING btree ("organization_id","grant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_token_grant_idx" ON "assistant_token" USING btree ("grant_id");