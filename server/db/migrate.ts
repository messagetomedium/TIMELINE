import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { resolve } from "node:path";
// Source scripts and the compiled image run from the repository/application root.
const folder=resolve("server/db/migrations");
async function applied(client:Pool|PoolClient) {
  const exists=await client.query<{table_name:string|null}>("select to_regclass('drizzle.__drizzle_migrations')::text as table_name");
  if(!exists.rows[0]?.table_name)return [];
  return (await client.query<{hash:string;created_at:string}>("select hash, created_at from drizzle.__drizzle_migrations order by created_at, id")).rows;
}
async function inspect(pool:Pool|PoolClient) {
  const expected=readMigrationFiles({migrationsFolder:folder}), rows=await applied(pool);
  if(rows.length>expected.length||rows.some((r,i)=>r.hash!==expected[i]?.hash||Number(r.created_at)!==expected[i].folderMillis))throw Error("Database migration version/checksum mismatch");
  return {expected,rows};
}
export async function assertMigrations(pool:Pool|PoolClient) {
  const {expected,rows}=await inspect(pool);
  if(rows.length!==expected.length)throw Error("Database migrations are pending");
}
export async function migrateDatabase(pool:Pool) {
  const client=await pool.connect();
  try {
    await client.query("select pg_advisory_lock(116001,1601)");
    await inspect(client);
    await migrate(drizzle(client),{migrationsFolder:folder});
    await assertMigrations(client);
  } finally {
    await client.query("select pg_advisory_unlock(116001,1601)").catch(()=>undefined);
    client.release();
  }
}
