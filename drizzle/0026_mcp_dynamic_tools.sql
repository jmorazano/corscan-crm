ALTER TABLE "mcp_integration" ADD COLUMN IF NOT EXISTS "tool_policy" jsonb;--> statement-breakpoint
ALTER TABLE "mcp_tool_call" ADD COLUMN IF NOT EXISTS "write" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_tool_call" ADD COLUMN IF NOT EXISTS "result_excerpt" text;