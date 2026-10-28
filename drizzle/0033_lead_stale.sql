-- 044: «pasar a perdido tras N días sin respuesta», por empresa (apagado por
-- defecto: NULL), y la marca en el lead para que vuelva solo si escribe.
CREATE TABLE IF NOT EXISTS "pipeline_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"stale_lost_days" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "stale_lost_at" timestamp;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "pipeline_settings" ADD CONSTRAINT "pipeline_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_settings_org_uq" ON "pipeline_settings" USING btree ("organization_id");
