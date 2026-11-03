CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_provider_unique" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "assignment_history" (
	"assignment_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"name_snapshot" text NOT NULL,
	"role_label" text NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "retired_target_kind" CHECK ("assignment_history"."kind" in ('process','task'))
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"process_id" uuid,
	"task_id" uuid,
	"person_id" uuid,
	"role_label" text NOT NULL,
	"person_snapshot" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "assignment_target" CHECK (("assignments"."process_id" is null) <> ("assignments"."task_id" is null))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"command_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" text NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"note" text NOT NULL,
	"anchor" text NOT NULL,
	"date" date,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "checkpoint_timing" CHECK (("checkpoints"."anchor" = 'free' and "checkpoints"."date" is not null) or ("checkpoints"."anchor" = 'project_end' and "checkpoints"."date" is null))
);
--> statement-breakpoint
CREATE TABLE "guest_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"creator_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"permissions" text DEFAULT 'read' NOT NULL,
	CONSTRAINT "guest_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "guest_link_scope" UNIQUE("workspace_id","id"),
	CONSTRAINT "guest_read_only" CHECK ("guest_links"."permissions" = 'read')
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guest_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "workspace_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"creator_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "workspace_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitation_uses" CHECK ("workspace_invitations"."max_uses" = 1 and "workspace_invitations"."used_count" between 0 and "workspace_invitations"."max_uses")
);
--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "workspace_memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "membership_role" CHECK ("workspace_memberships"."role" in ('owner','admin'))
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"default_role" text NOT NULL,
	"contacts" text NOT NULL,
	"note" text NOT NULL,
	"linked_user_id" text,
	"archived_at" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "person_scope" UNIQUE("workspace_id","id"),
	CONSTRAINT "person_name" CHECK (length(trim("people"."first_name" || "people"."last_name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "process_lanes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"sort_index" integer NOT NULL,
	CONSTRAINT "process_lane_scope" UNIQUE("workspace_id","project_id","stage_id","id")
);
--> statement-breakpoint
CREATE TABLE "processes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"lane_id" uuid NOT NULL,
	"title" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"start_date" date NOT NULL,
	"end_date_exclusive" date NOT NULL,
	"status" text NOT NULL,
	"color" text NOT NULL,
	"sort_index" integer NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "process_scope" UNIQUE("workspace_id","project_id","id"),
	CONSTRAINT "process_stage_scope" UNIQUE("workspace_id","project_id","stage_id","id"),
	CONSTRAINT "process_dates" CHECK ("processes"."start_date" < "processes"."end_date_exclusive"),
	CONSTRAINT "process_status" CHECK ("processes"."status" in ('Не начато','В работе','Согласование','Пауза','Готово','Закрыта')),
	CONSTRAINT "process_color" CHECK ("processes"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "project_access" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "project_access_workspace_id_project_id_user_id_pk" PRIMARY KEY("workspace_id","project_id","user_id"),
	CONSTRAINT "project_access_role" CHECK ("project_access"."role" in ('author','responsible'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"creator_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"anchor_date" date NOT NULL,
	"start_date" date NOT NULL,
	"end_date_exclusive" date NOT NULL,
	"sort_index" integer NOT NULL,
	"is_scheduled" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"visibility" text DEFAULT 'workspace' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"schedule_revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "project_scope" UNIQUE("workspace_id","id"),
	CONSTRAINT "project_dates" CHECK ("projects"."start_date" < "projects"."end_date_exclusive"),
	CONSTRAINT "project_visibility" CHECK ("projects"."visibility" = 'workspace'),
	CONSTRAINT "project_revisions" CHECK ("projects"."revision" >= 0 and "projects"."schedule_revision" >= 0 and "projects"."sort_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "command_receipts" (
	"workspace_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"command_id" uuid NOT NULL,
	"project_id" uuid,
	"payload_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "command_receipts_workspace_id_actor_id_command_id_pk" PRIMARY KEY("workspace_id","actor_id","command_id")
);
--> statement-breakpoint
CREATE TABLE "result_placements" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"result_id" uuid PRIMARY KEY NOT NULL,
	"is_placed" boolean NOT NULL,
	"hidden_by_user" boolean NOT NULL,
	"layout_mode" text NOT NULL,
	"sort_index" integer NOT NULL,
	"manual_y" double precision NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "placement_mode" CHECK ("result_placements"."layout_mode" in ('auto','manual') and "result_placements"."manual_y" >= 0 and "result_placements"."sort_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"process_id" uuid,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "result_scope" UNIQUE("workspace_id","project_id","id")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date_exclusive" date NOT NULL,
	"sort_index" integer NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stage_scope" UNIQUE("workspace_id","project_id","id"),
	CONSTRAINT "stage_order" UNIQUE("project_id","sort_index"),
	CONSTRAINT "stage_dates" CHECK ("stages"."start_date" < "stages"."end_date_exclusive")
);
--> statement-breakpoint
CREATE TABLE "task_lanes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	"sort_index" integer NOT NULL,
	CONSTRAINT "task_lane_scope" UNIQUE("workspace_id","project_id","process_id","id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	"lane_id" uuid NOT NULL,
	"title" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"start_date" date NOT NULL,
	"end_date_exclusive" date NOT NULL,
	"status" text NOT NULL,
	"sort_index" integer NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "task_scope" UNIQUE("workspace_id","project_id","id"),
	CONSTRAINT "task_dates" CHECK ("tasks"."start_date" < "tasks"."end_date_exclusive"),
	CONSTRAINT "task_status" CHECK ("tasks"."status" in ('Не начато','В работе','Согласование','Пауза','Готово','Закрыта'))
);
--> statement-breakpoint
CREATE TABLE "auth_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "view_preferences" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "view_preferences_workspace_id_user_id_scope_pk" PRIMARY KEY("workspace_id","user_id","scope")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"people_revision" integer DEFAULT 0 NOT NULL,
	"max_projects" integer DEFAULT 40 NOT NULL,
	"max_processes" integer DEFAULT 100 NOT NULL,
	"max_tasks" integer DEFAULT 40 NOT NULL,
	"max_people" integer DEFAULT 100 NOT NULL,
	"max_editors" integer DEFAULT 4 NOT NULL,
	"max_guests" integer DEFAULT 6 NOT NULL,
	CONSTRAINT "workspace_limits_positive" CHECK ("workspaces"."revision" >= 0 and "workspaces"."people_revision" >= 0 and "workspaces"."max_projects" > 0 and "workspaces"."max_processes" > 0 and "workspaces"."max_tasks" > 0 and "workspaces"."max_people" > 0 and "workspaces"."max_editors" > 0 and "workspaces"."max_guests" > 0)
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_history" ADD CONSTRAINT "assignment_history_workspace_id_person_id_people_workspace_id_id_fk" FOREIGN KEY ("workspace_id","person_id") REFERENCES "public"."people"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_workspace_id_project_id_process_id_processes_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","process_id") REFERENCES "public"."processes"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_workspace_id_project_id_task_id_tasks_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","task_id") REFERENCES "public"."tasks"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_workspace_id_person_id_people_workspace_id_id_fk" FOREIGN KEY ("workspace_id","person_id") REFERENCES "public"."people"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_auth_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_links" ADD CONSTRAINT "guest_links_creator_id_auth_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_links" ADD CONSTRAINT "guest_links_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_workspace_id_link_id_guest_links_workspace_id_id_fk" FOREIGN KEY ("workspace_id","link_id") REFERENCES "public"."guest_links"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_creator_id_auth_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_linked_user_id_auth_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_lanes" ADD CONSTRAINT "process_lanes_workspace_id_project_id_stage_id_stages_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","stage_id") REFERENCES "public"."stages"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processes" ADD CONSTRAINT "processes_workspace_id_project_id_stage_id_lane_id_process_lanes_workspace_id_project_id_stage_id_id_fk" FOREIGN KEY ("workspace_id","project_id","stage_id","lane_id") REFERENCES "public"."process_lanes"("workspace_id","project_id","stage_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access" ADD CONSTRAINT "project_access_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access" ADD CONSTRAINT "project_access_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_creator_id_auth_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_receipts" ADD CONSTRAINT "command_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_receipts" ADD CONSTRAINT "command_receipts_actor_id_auth_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_receipts" ADD CONSTRAINT "command_receipts_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_placements" ADD CONSTRAINT "result_placements_workspace_id_project_id_result_id_results_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","result_id") REFERENCES "public"."results"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_workspace_id_project_id_stage_id_stages_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","stage_id") REFERENCES "public"."stages"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_workspace_id_project_id_stage_id_process_id_processes_workspace_id_project_id_stage_id_id_fk" FOREIGN KEY ("workspace_id","project_id","stage_id","process_id") REFERENCES "public"."processes"("workspace_id","project_id","stage_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_lanes" ADD CONSTRAINT "task_lanes_workspace_id_project_id_process_id_processes_workspace_id_project_id_id_fk" FOREIGN KEY ("workspace_id","project_id","process_id") REFERENCES "public"."processes"("workspace_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_project_id_process_id_lane_id_task_lanes_workspace_id_project_id_process_id_id_fk" FOREIGN KEY ("workspace_id","project_id","process_id","lane_id") REFERENCES "public"."task_lanes"("workspace_id","project_id","process_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_preferences" ADD CONSTRAINT "view_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_preferences" ADD CONSTRAINT "view_preferences_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_auth_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_process_lead" ON "assignments" USING btree ("process_id") WHERE "assignments"."process_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "one_task_person" ON "assignments" USING btree ("task_id") WHERE "assignments"."task_id" is not null;--> statement-breakpoint
CREATE INDEX "assignments_person_project_idx" ON "assignments" USING btree ("workspace_id","person_id","project_id");--> statement-breakpoint
CREATE INDEX "audit_workspace_time_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "guest_sessions_workspace_expiry_idx" ON "guest_sessions" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE INDEX "invitations_workspace_idx" ON "workspace_invitations" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_owner_per_workspace" ON "workspace_memberships" USING btree ("workspace_id") WHERE "workspace_memberships"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "workspace_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "people_workspace_idx" ON "people" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "process_lanes_order_idx" ON "process_lanes" USING btree ("project_id","sort_index");--> statement-breakpoint
CREATE INDEX "process_lane_dates_idx" ON "processes" USING btree ("project_id","lane_id","start_date");--> statement-breakpoint
CREATE INDEX "project_order_idx" ON "projects" USING btree ("workspace_id","sort_index");--> statement-breakpoint
CREATE UNIQUE INDEX "one_result_per_process" ON "results" USING btree ("process_id") WHERE "results"."process_id" is not null;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_lanes_order_idx" ON "task_lanes" USING btree ("project_id","process_id","sort_index");--> statement-breakpoint
CREATE INDEX "task_lane_dates_idx" ON "tasks" USING btree ("project_id","lane_id","start_date");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "auth_verifications" USING btree ("identifier");