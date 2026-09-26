ALTER TABLE "instagram_integration" ADD COLUMN "history_status" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "history_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "history_finished_at" timestamp;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "history_threads" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "history_messages" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "instagram_integration" ADD COLUMN "history_error" text;