ALTER TABLE "campaign" DROP CONSTRAINT "campaign_template_id_template_id_fk";
--> statement-breakpoint
ALTER TABLE "campaign" ALTER COLUMN "template_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "template_name" text;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill del snapshot (re-ejecutable): las campañas existentes toman el
-- nombre de su plantilla actual; las que ya lo tengan no se tocan.
UPDATE "campaign" c SET "template_name" = t."name" FROM "template" t WHERE c."template_id" = t."id" AND c."template_name" IS NULL;
