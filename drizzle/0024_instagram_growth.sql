CREATE TABLE "instagram_comment_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"comment_id" text NOT NULL,
	"media_id" text,
	"from_id" text NOT NULL,
	"username" text,
	"text" text,
	"live" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"rule_id" text,
	"status" text NOT NULL,
	"detail" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"public_reply_id" text,
	"recipient_id" text,
	"conversation_id" text,
	"follow_up_done_at" timestamp,
	"commented_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_comment_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"target" text NOT NULL,
	"media_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"media_preview" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"dm_text" text NOT NULL,
	"button_label" text,
	"follow_up_text" text,
	"public_replies" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_entry_link" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"instruction" text,
	"uses" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "ig_origin" jsonb;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "granted_scopes" text[];--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "subscribed_fields" text[];--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "moderation_words" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "ice_breakers" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "persistent_menu" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "profile_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "profile_error" text;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "standby_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "comments_webhook_at" timestamp;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "comments_polled_at" timestamp;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "comments_error" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "instagram_comment_event" ADD CONSTRAINT "instagram_comment_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_comment_rule" ADD CONSTRAINT "instagram_comment_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_entry_link" ADD CONSTRAINT "instagram_entry_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_comment_event_org_comment_uq" ON "instagram_comment_event" USING btree ("organization_id","comment_id");--> statement-breakpoint
CREATE INDEX "instagram_comment_event_org_created_idx" ON "instagram_comment_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "instagram_comment_event_org_from_idx" ON "instagram_comment_event" USING btree ("organization_id","from_id");--> statement-breakpoint
CREATE INDEX "instagram_comment_rule_org_idx" ON "instagram_comment_rule" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_entry_link_org_slug_uq" ON "instagram_entry_link" USING btree ("organization_id","slug");