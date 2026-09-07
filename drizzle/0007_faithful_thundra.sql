ALTER TABLE "conversation" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "conversation_tags_gin_idx" ON "conversation" USING gin ("tags");