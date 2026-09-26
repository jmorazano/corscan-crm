CREATE TABLE "instagram_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"ig_user_id" text NOT NULL,
	"username" text,
	"name" text,
	"profile_picture_url" text,
	"token_cipher" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_tag" text NOT NULL,
	"token_expires_at" timestamp NOT NULL,
	"token_refreshed_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"connected_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "channel" text DEFAULT 'whatsapp' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "ig_username" text;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD CONSTRAINT "instagram_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_integration_org_uq" ON "instagram_integration" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_integration_account_uq" ON "instagram_integration" USING btree ("ig_user_id");