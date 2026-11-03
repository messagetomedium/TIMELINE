import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { databaseTls } from "./settings";
import type { DatabaseSettings } from "./settings";
export type Database = NodePgDatabase<typeof schema>;
export type QueryDatabase = Pick<Database,"select"|"selectDistinct"|"insert"|"update"|"delete"|"execute">;
export function connect(databaseUrl: string, settings: DatabaseSettings = { DB_SSL_MODE: "disable" }) {
  const pool = new Pool({ connectionString:databaseUrl, ssl:databaseTls(settings), max:10, connectionTimeoutMillis:5000, idleTimeoutMillis:30_000, application_name:"timeline" });
  // Idle socket failures must make readiness fail, not terminate the HTTP process.
  // Active queries still reject normally. Driver errors may contain credentials.
  pool.on("error", () => undefined);
  return { pool, db:drizzle(pool,{schema}) };
}
