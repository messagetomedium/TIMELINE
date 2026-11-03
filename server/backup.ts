import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { open, link, rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { escapeIdentifier } from "pg";
import type { PoolClient } from "pg";
import { z } from "zod";
import { connect } from "./db/connection";
import { assertMigrations } from "./db/migrate";
import { databaseUrlSchema } from "./db/settings";
import type { DatabaseSettings } from "./db/settings";

const manifestSchema = z.strictObject({ version: z.literal(1), tables: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)) });
function pgEnvironment(connection: string, settings: DatabaseSettings): NodeJS.ProcessEnv {
  const url = new URL(connection);
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG"))),
    PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: "5", PGAPPNAME: "timeline-backup",
    PGSSLMODE: settings.DB_SSL_MODE === "verify-full" ? "verify-full" : "disable",
    ...(settings.DB_SSL_CA_FILE ? { PGSSLROOTCERT: settings.DB_SSL_CA_FILE } : {}),
  };
}
function tool(command: string, args: string[], env: NodeJS.ProcessEnv, stdout?: number): Promise<void> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", stdout ?? "ignore", "ignore"] });
    child.once("error", () => { reject(Error("PostgreSQL backup tool unavailable")); });
    child.once("close", (code) => { if (code === 0) done(); else reject(Error("PostgreSQL backup tool failed")); });
  });
}
async function tables(client: PoolClient) {
  return (await client.query<{ schema: string; name: string }>("select schemaname as schema, tablename as name from pg_tables where schemaname in ('public','drizzle') order by schemaname collate \"C\", tablename collate \"C\"" )).rows;
}
async function fingerprint(client: PoolClient) {
  await client.query("set local timezone = 'UTC'");
  const result: Record<string, string> = {};
  for (const table of await tables(client)) {
    const rows = await client.query<{ data: unknown }>(`select to_jsonb(t) as data from ${escapeIdentifier(table.schema)}.${escapeIdentifier(table.name)} t order by to_jsonb(t)::text collate "C"`);
    result[`${table.schema}.${table.name}`] = createHash("sha256").update(JSON.stringify(rows.rows)).digest("hex");
  }
  return result;
}
export async function backupDatabase(sourceUrl: string, file: string, settings: DatabaseSettings) {
  databaseUrlSchema.parse(sourceUrl);
  const source = connect(sourceUrl, settings), target = resolve(file), temporary = `${target}.partial-${randomUUID()}`;
  let client: PoolClient | undefined, archiveCreated = false, manifestCreated = false;
  try {
    client = await source.pool.connect();
    // Coordinate with the existing migration runner before acquiring table locks.
    await client.query("select pg_advisory_lock_shared(116001,1601)");
    await client.query("begin isolation level repeatable read read only");
    await assertMigrations(client);
    const snapshot = (await client.query<{ id: string }>("select pg_export_snapshot() as id")).rows[0]?.id;
    if (!snapshot) throw Error("Cannot export a consistent snapshot");
    const hashes = await fingerprint(client);
    const output = await open(temporary, "wx", 0o600);
    try {
      await tool("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--lock-wait-timeout=10000", `--snapshot=${snapshot}`], pgEnvironment(sourceUrl, settings), output.fd);
      await output.sync();
    } finally { await output.close(); }
    await client.query("commit");
    const metadata = await open(`${temporary}.json`, "wx", 0o600);
    try { await metadata.writeFile(JSON.stringify({ version: 1, tables: hashes })); await metadata.sync(); }
    finally { await metadata.close(); }
    // Hard links fail if the destination exists. Never overwrite a prior backup.
    await link(temporary, target); archiveCreated = true;
    await link(`${temporary}.json`, `${target}.json`); manifestCreated = true;
  } catch {
    if (archiveCreated && !manifestCreated) await rm(target, { force: true });
    throw Error("Backup failed; existing backups were not overwritten");
  } finally {
    await client?.query("rollback").catch(() => undefined);
    await client?.query("select pg_advisory_unlock_shared(116001,1601)").catch(() => undefined);
    client?.release();
    await source.pool.end();
    await rm(temporary, { force: true }); await rm(`${temporary}.json`, { force: true });
  }
}
export async function verifyBackup(sourceUrl: string, restoreUrl: string, file: string, settings: DatabaseSettings) {
  databaseUrlSchema.parse(sourceUrl); databaseUrlSchema.parse(restoreUrl);
  const source = new URL(sourceUrl), target = new URL(restoreUrl);
  if (!decodeURIComponent(target.pathname).endsWith("_restore_test") ||
      (source.hostname === target.hostname && (source.port || "5432") === (target.port || "5432") && source.pathname === target.pathname)) throw Error("Restore requires a different isolated *_restore_test database");
  const manifest = manifestSchema.parse(JSON.parse(await readFile(`${resolve(file)}.json`, "utf8")));
  const restore = connect(restoreUrl, settings);
  let client: PoolClient | undefined;
  try {
    client = await restore.pool.connect();
    // Refuse every user schema/object, not just existing TIMELINE tables.
    const occupied = await client.query<{ occupied: boolean }>("select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname !~ '^pg_toast' and n.nspname !~ '^pg_temp') or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public') or exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public') or exists(select 1 from pg_namespace where nspname not in ('public','pg_catalog','information_schema') and nspname !~ '^pg_') as occupied");
    if (occupied.rows[0]?.occupied !== false) throw Error("Restore target must be empty");
    await tool("pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", "--dbname", decodeURIComponent(target.pathname.slice(1)), resolve(file)], pgEnvironment(restoreUrl, settings));
    await assertMigrations(client);
    await client.query("begin isolation level repeatable read read only");
    const actual = await fingerprint(client);
    if (JSON.stringify(actual) !== JSON.stringify(manifest.tables)) throw Error("Restored data differs from the exported snapshot");
    await client.query("commit");
  } finally {
    await client?.query("rollback").catch(() => undefined);
    client?.release(); await restore.pool.end();
  }
}
