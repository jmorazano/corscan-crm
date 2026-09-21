CREATE TABLE "mcp_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"profile" text DEFAULT 'generic' NOT NULL,
	"label" text NOT NULL,
	"endpoint_url" text NOT NULL,
	"auth_scheme" text DEFAULT 'bearer' NOT NULL,
	"credential" jsonb,
	"credential_last4" text,
	"status" text DEFAULT 'enabled' NOT NULL,
	"session_mode" text DEFAULT 'stateless' NOT NULL,
	"server_name" text,
	"server_version" text,
	"protocol_version" text,
	"instructions" text,
	"use_server_instructions" boolean DEFAULT false NOT NULL,
	"tools" jsonb,
	"last_handshake_at" timestamp,
	"last_error_code" text,
	"last_error_at" timestamp,
	"catalog" jsonb,
	"catalog_fetched_at" timestamp,
	"catalog_ttl_minutes" integer DEFAULT 60 NOT NULL,
	"timezone" text DEFAULT 'America/Argentina/Cordoba' NOT NULL,
	"agent_tools_enabled" boolean DEFAULT true NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"max_response_bytes" integer DEFAULT 524288 NOT NULL,
	"enabled_by" text,
	"enabled_at" timestamp DEFAULT now() NOT NULL,
	"connected_by" text,
	"connected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_tool_call" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"conversation_id" text,
	"tool" text NOT NULL,
	"args_hash" text NOT NULL,
	"args" jsonb,
	"status" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"http_status" integer,
	"duration_ms" integer,
	"response_bytes" integer,
	"is_test" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_integration" ADD CONSTRAINT "mcp_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_call" ADD CONSTRAINT "mcp_tool_call_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_call" ADD CONSTRAINT "mcp_tool_call_integration_id_mcp_integration_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."mcp_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tool_call" ADD CONSTRAINT "mcp_tool_call_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_integration_org_uq" ON "mcp_integration" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "mcp_tool_call_org_created_idx" ON "mcp_tool_call" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_tool_call_org_conv_idx" ON "mcp_tool_call" USING btree ("organization_id","conversation_id","created_at");