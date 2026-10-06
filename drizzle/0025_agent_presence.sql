CREATE TABLE "conversation_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"actor_user_id" text,
	"actor_name" text,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN "team_silence_ms" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "sent_by_user_id" text;--> statement-breakpoint
ALTER TABLE "conversation_event" ADD CONSTRAINT "conversation_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_event" ADD CONSTRAINT "conversation_event_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_event" ADD CONSTRAINT "conversation_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_event_org_conv_idx" ON "conversation_event" USING btree ("organization_id","conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_sent_by_user_id_user_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;