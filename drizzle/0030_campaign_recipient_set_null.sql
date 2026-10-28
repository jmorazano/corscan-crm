ALTER TABLE "campaign_recipient" DROP CONSTRAINT IF EXISTS "campaign_recipient_conversation_id_conversation_id_fk";
--> statement-breakpoint
ALTER TABLE "campaign_recipient" DROP CONSTRAINT IF EXISTS "campaign_recipient_message_id_message_id_fk";
--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;
