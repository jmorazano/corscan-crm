-- 018: espacios de trabajo — última empresa usada por usuario y una sola
-- membresía por (empresa, usuario). Re-ejecutable: IF NOT EXISTS + dedupe
-- previo (se conserva la membresía más antigua).
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_organization_id" text;--> statement-breakpoint
DELETE FROM "member" m USING "member" d WHERE m.organization_id = d.organization_id AND m.user_id = d.user_id AND (m.created_at > d.created_at OR (m.created_at = d.created_at AND m.id > d.id));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "member_org_user_uq" ON "member" USING btree ("organization_id","user_id");
