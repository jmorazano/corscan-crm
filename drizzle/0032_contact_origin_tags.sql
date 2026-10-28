CREATE TABLE IF NOT EXISTS "contact_origin_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"phrase" text NOT NULL,
	"tag" text NOT NULL,
	"append_month" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN IF NOT EXISTS "arrived_min_days" integer;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "origin_at" timestamp;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "contact_origin_rule" ADD CONSTRAINT "contact_origin_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_origin_rule_org_idx" ON "contact_origin_rule" USING btree ("organization_id","created_at");--> statement-breakpoint
-- 043: backfill re-ejecutable. Los contactos de conversaciones que ya
-- llegaron por un anuncio Click-to-WhatsApp (035) se llevan meta-ads-AAAA-MM
-- con el mes real del clic (hora de Argentina) y su origin_at. Solo agrega
-- lo que falta y respeta el tope de 20 etiquetas por contacto (004).
UPDATE "contact" AS c SET
	"tags" = CASE
		WHEN o.tag = ANY(c."tags") OR cardinality(c."tags") >= 20 THEN c."tags"
		ELSE c."tags" || o.tag
	END,
	"origin_at" = greatest(c."origin_at", o.at)
FROM (
	SELECT cv."contact_id", cv."organization_id",
		'meta-ads-' || to_char(((cv."ig_origin"->>'at')::timestamptz) AT TIME ZONE 'America/Argentina/Cordoba', 'YYYY-MM') AS tag,
		((cv."ig_origin"->>'at')::timestamptz) AT TIME ZONE 'UTC' AS at
	FROM "conversation" AS cv
	WHERE cv."is_test" = false
		AND cv."ig_origin"->>'kind' = 'ad'
		AND cv."ig_origin"->>'channel' = 'whatsapp'
		AND cv."ig_origin"->>'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
) AS o
WHERE c."id" = o."contact_id"
	AND c."organization_id" = o."organization_id"
	AND c."is_test" = false;
