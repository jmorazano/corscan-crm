ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "media_state" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "media_summary" text;--> statement-breakpoint
-- 020: las notas de voz del entrenador que ya existen llevan el estado de la
-- transcripción en `status` (015). Se traslada a `media_state`, o la bandeja
-- mostraría "Transcribiendo…" para siempre en las que habían fallado.
UPDATE "message"
SET "media_state" = CASE WHEN "status" = 'failed' THEN 'failed' ELSE 'ready' END
WHERE "type" = 'audio' AND "direction" = 'out' AND "media_state" IS NULL;
