ALTER TABLE "campaign" ADD COLUMN "variable_values" jsonb;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "variable_bindings" jsonb;