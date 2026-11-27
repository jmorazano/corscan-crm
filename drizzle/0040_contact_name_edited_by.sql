ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "name_edited_by_user_id" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "name_edited_by_name" text;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "contact" ADD CONSTRAINT "contact_name_edited_by_user_id_user_id_fk" FOREIGN KEY ("name_edited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
