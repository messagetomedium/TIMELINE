import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
export type Database = NodePgDatabase<typeof schema>;
export type QueryDatabase = Pick<Database,"select"|"selectDistinct"|"insert"|"update"|"delete"|"execute">;
export function connect(databaseUrl: string) {
  const pool = new Pool({ connectionString:databaseUrl, max:10, connectionTimeoutMillis:5000, idleTimeoutMillis:30_000, application_name:"timeline" });
  return { pool, db:drizzle(pool,{schema}) };
}
