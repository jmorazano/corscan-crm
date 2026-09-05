CREATE TABLE "campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"template_id" text NOT NULL,
	"tag_filter" text[] DEFAULT '{}'::text[] NOT NULL,
	"variable_mode" text DEFAULT 'contact_name' NOT NULL,
	"variable_text" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"paused_reason" text,
	"runner_generation" integer DEFAULT 0 NOT NULL,
	"launched_at" timestamp,
	"completed_at" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recipient" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"error" text,
	"conversation_id" text,
	"message_id" text,
	"wa_message_id" text,
	"sent_at" timestamp,
	"replied_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "initiated_send" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "send_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"daily_initiated_limit" integer DEFAULT 250 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "consent_source" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "opted_out_at" timestamp;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "opt_out_reverted_at" timestamp;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "opt_out_reverted_by" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiated_send" ADD CONSTRAINT "initiated_send_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiated_send" ADD CONSTRAINT "initiated_send_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "send_settings" ADD CONSTRAINT "send_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_org_created_idx" ON "campaign" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipient_uq" ON "campaign_recipient" USING btree ("campaign_id","contact_id");--> statement-breakpoint
CREATE INDEX "campaign_recipient_org_campaign_status_idx" ON "campaign_recipient" USING btree ("organization_id","campaign_id","status");--> statement-breakpoint
CREATE INDEX "campaign_recipient_org_contact_idx" ON "campaign_recipient" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "initiated_send_org_sent_idx" ON "initiated_send" USING btree ("organization_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "send_settings_org_uq" ON "send_settings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contact_tags_gin_idx" ON "contact" USING gin ("tags");--> statement-breakpoint
UPDATE "contact" SET "is_test" = true WHERE "id" IN (SELECT DISTINCT "contact_id" FROM "conversation" WHERE "is_test" = true);--> statement-breakpoint
UPDATE "contact" c SET "consent_source" = 'inbound', "consent_at" = m.first_in
FROM (
  SELECT cv."contact_id" AS cid,
         MIN(COALESCE(msg."wa_timestamp", msg."created_at")) AS first_in
  FROM "message" msg
  JOIN "conversation" cv ON msg."conversation_id" = cv."id"
  WHERE msg."direction" = 'in' AND cv."is_test" = false
  GROUP BY cv."contact_id"
) m
WHERE c."id" = m.cid AND c."consent_source" IS NULL AND c."is_test" = false;
