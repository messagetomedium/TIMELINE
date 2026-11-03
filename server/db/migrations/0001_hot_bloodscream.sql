ALTER TABLE "auth_accounts" ALTER COLUMN "id" SET DEFAULT pg_catalog.gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "auth_rate_limits" ALTER COLUMN "id" SET DEFAULT pg_catalog.gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "auth_sessions" ALTER COLUMN "id" SET DEFAULT pg_catalog.gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "auth_users" ALTER COLUMN "id" SET DEFAULT pg_catalog.gen_random_uuid()::text;--> statement-breakpoint
ALTER TABLE "auth_verifications" ALTER COLUMN "id" SET DEFAULT pg_catalog.gen_random_uuid()::text;