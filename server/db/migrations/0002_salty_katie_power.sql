ALTER TABLE "processes" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;