CREATE TABLE "meli_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"ml_user_id" text NOT NULL,
	"nickname" text,
	"site_id" text DEFAULT 'MLA' NOT NULL,
	"refresh_token_cipher" text NOT NULL,
	"refresh_token_iv" text NOT NULL,
	"refresh_token_tag" text NOT NULL,
	"access_token_cipher" text,
	"access_token_iv" text,
	"access_token_tag" text,
	"access_token_expires_at" timestamp,
	"status" text DEFAULT 'connected' NOT NULL,
	"agent_enabled" boolean DEFAULT true NOT NULL,
	"sync_status" text DEFAULT 'idle' NOT NULL,
	"sync_started_at" timestamp,
	"last_sync_at" timestamp,
	"last_sync_error" text,
	"listings_count" integer DEFAULT 0 NOT NULL,
	"connected_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meli_listing" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"item_id" text NOT NULL,
	"title" text NOT NULL,
	"category_id" text,
	"operation" text,
	"property_type" text,
	"price" double precision,
	"currency" text,
	"rooms" integer,
	"bedrooms" integer,
	"bathrooms" integer,
	"parking" integer,
	"covered_area" double precision,
	"total_area" double precision,
	"neighborhood" text,
	"city" text,
	"state" text,
	"address_line" text,
	"permalink" text,
	"thumbnail" text,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"ml_updated_at" timestamp,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "shared_personal_number" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "known_from_phone_at" timestamp;--> statement-breakpoint
ALTER TABLE "meli_integration" ADD CONSTRAINT "meli_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meli_listing" ADD CONSTRAINT "meli_listing_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meli_integration_org_uq" ON "meli_integration" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meli_integration_ml_user_uq" ON "meli_integration" USING btree ("ml_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meli_listing_org_item_uq" ON "meli_listing" USING btree ("organization_id","item_id");--> statement-breakpoint
CREATE INDEX "meli_listing_org_op_idx" ON "meli_listing" USING btree ("organization_id","operation");--> statement-breakpoint
-- 025 (AC4.4): backfill de «conocido desde el celular» SOLO en empresas con
-- historial de coexistence (history_import fuera de 'idle'). Tres señales:
-- (a) la conversación tiene mensajes del celular (historial importado o ecos),
-- (b) el contacto nunca escribió por la nube y no tiene consentimiento de
--     import/manual/api (lo creó la agenda o el historial),
-- (c) el contacto existía (agenda) bastante antes de su primer entrante por
--     la nube: un amigo que escribió después de conectar.
-- Re-ejecutable: solo toca filas con la marca en NULL.
UPDATE "contact" c SET "known_from_phone_at" = c."created_at"
WHERE c."known_from_phone_at" IS NULL
  AND c."is_test" = false
  AND c."channel" = 'whatsapp'
  AND EXISTS (
    SELECT 1 FROM "history_import" h
    WHERE h."organization_id" = c."organization_id" AND h."status" <> 'idle'
  )
  AND (
    EXISTS (
      SELECT 1 FROM "conversation" cv
      JOIN "message" m ON m."conversation_id" = cv."id"
      WHERE cv."contact_id" = c."id" AND m."source" IN ('history', 'phone')
    )
    OR c."consent_source" IS NULL
    OR (
      c."consent_source" = 'inbound'
      AND c."created_at" < (
        SELECT min(m."created_at") - interval '5 minutes'
        FROM "conversation" cv
        JOIN "message" m ON m."conversation_id" = cv."id"
        WHERE cv."contact_id" = c."id" AND m."direction" = 'in' AND m."source" = 'cloud'
      )
    )
  );
