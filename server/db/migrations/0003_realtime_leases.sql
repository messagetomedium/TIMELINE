CREATE TABLE "collaboration_state" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigint DEFAULT 0 NOT NULL,
	"fence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "collaboration_counters_safe" CHECK ("collaboration_state"."sequence" between 0 and 9007199254740991 and "collaboration_state"."fence" between 0 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "edit_leases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"session_id" text NOT NULL,
	"command_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"fence" bigint NOT NULL,
	"resources" jsonb NOT NULL,
	"basis" jsonb NOT NULL,
	"delta_hash" text NOT NULL,
	"base_revision" integer NOT NULL,
	"people_revision" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lease_intent_unique" UNIQUE("workspace_id","owner_id","session_id","command_id")
);
--> statement-breakpoint
CREATE TABLE "workspace_events" (
	"workspace_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"project_id" uuid,
	"command_id" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"workspace_revision" integer NOT NULL,
	"people_revision" integer NOT NULL,
	"resources" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_events_workspace_id_sequence_pk" PRIMARY KEY("workspace_id","sequence")
);
--> statement-breakpoint
ALTER TABLE "collaboration_state" ADD CONSTRAINT "collaboration_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_leases" ADD CONSTRAINT "edit_leases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_leases" ADD CONSTRAINT "edit_leases_owner_id_auth_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_leases" ADD CONSTRAINT "edit_leases_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_leases" ADD CONSTRAINT "edit_leases_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_events" ADD CONSTRAINT "workspace_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_events" ADD CONSTRAINT "workspace_events_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leases_project_expiry_idx" ON "edit_leases" USING btree ("workspace_id","project_id","expires_at");--> statement-breakpoint
CREATE INDEX "events_project_revision_idx" ON "workspace_events" USING btree ("workspace_id","project_id","revision");