CREATE TABLE "history_import" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"days" integer DEFAULT 60 NOT NULL,
	"request_id" text,
	"requested_at" timestamp,
	"last_chunk_at" timestamp,
	"finished_at" timestamp,
	"progress" integer DEFAULT 0 NOT NULL,
	"imported_messages" integer DEFAULT 0 NOT NULL,
	"skipped_old" integer DEFAULT 0 NOT NULL,
	"threads" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "source" text DEFAULT 'cloud' NOT NULL;--> statement-breakpoint
ALTER TABLE "history_import" ADD CONSTRAINT "history_import_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;