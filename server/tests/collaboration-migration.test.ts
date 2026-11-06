import { expect, it } from "vitest";
import { Pool, escapeIdentifier } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, copyFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { z } from "zod";
import { migrateDatabase, assertMigrations } from "../db/migrate";
import { WORKSPACE_ID } from "../../src/domain/v2/model";

it("restores a V2.0B/V2.0C/V2.1A SQL dump into a separate database before the forward-only V2.1B migration", async () => {
  const url = process.env.TEST_DATABASE_URL, container = process.env.TEST_PG_CONTAINER;
  if (!url || !new URL(url).pathname.endsWith("_test") || !container) throw Error("Isolated *_test and TEST_PG_CONTAINER required for PostgreSQL 17 dump/restore");
  const admin = new Pool({ connectionString: url }), suffix = randomBytes(6).toString("hex");
  const sourceName = `timeline_${suffix}_legacy_test`, restoredName = `timeline_${suffix}_restored_test`, folder = await mkdtemp(join(tmpdir(), "timeline-v21b-upgrade-"));
  const withName = (name: string) => { const value = new URL(url); value.pathname = `/${name}`; return value.toString(); };
  let source: Pool | undefined, restored: Pool | undefined;
  try {
    await admin.query(`create database ${escapeIdentifier(sourceName)}`); await admin.query(`create database ${escapeIdentifier(restoredName)}`);
    source = new Pool({ connectionString: withName(sourceName) }); restored = new Pool({ connectionString: withName(restoredName) });
    const journal = z.object({ version: z.string(), dialect: z.string(), entries: z.array(z.object({ idx: z.number(), version: z.string(), when: z.number(), tag: z.string(), breakpoints: z.boolean() })) })
      .parse(JSON.parse(await readFile(resolve("server/db/migrations/meta/_journal.json"), "utf8")) as unknown);
    const legacy = { ...journal, entries: journal.entries.filter((e) => e.idx < 3) };
    await mkdir(join(folder, "meta")); await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(legacy));
    for (const entry of legacy.entries) await copyFile(resolve(`server/db/migrations/${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    await migrate(drizzle(source), { migrationsFolder: folder });
    const user = randomUUID(), project = randomUUID();
    await source.query("insert into auth_users(id,name,email,email_verified) values($1,'Legacy owner','migration@example.test',true)", [user]);
    await source.query("insert into workspaces(id,name,owner_user_id) values($1,'MEDIUM',$2)", [WORKSPACE_ID, user]);
    await source.query("insert into workspace_memberships(workspace_id,user_id,role) values($1,$2,'owner')", [WORKSPACE_ID, user]);
    await source.query("insert into projects(id,workspace_id,creator_id,name,anchor_date,start_date,end_date_exclusive,sort_index,created_at,updated_at) values($1,$2,$3,'Legacy project','2026-11-02','2026-11-02','2026-11-16',0,now(),now())", [project, WORKSPACE_ID, user]);
    const view = { projectId: project, gridStep: "1w", zoomPxPerDay: 28, cameraX: 48, cameraY: 123, showWeekends: false, expandedProcessIds: [], expandedAssigneeGroupIds: [], showPeoplePanel: true };
    await source.query("insert into view_preferences(workspace_id,user_id,scope,value) values($1,$2,$3,$4)", [WORKSPACE_ID, user, `project:${project}`, JSON.stringify(view)]);
    const tables = (await source.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map((r) => r.tablename);
    const contents = async (pool: Pool) => {
      const values: Record<string, string> = {};
      for (const name of tables) values[name] = JSON.stringify((await pool.query<{ value: unknown }>(`select to_jsonb(t) as value from ${escapeIdentifier(name)} t`)).rows.map((r) => JSON.stringify(r.value)).sort());
      return values;
    };
    const before = await contents(source), env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"].includes(key)));
    const base = ["--host=unix:///var/run/docker.sock", "exec"], options = { env, maxBuffer: 32 * 1024 * 1024 };
    const dump = execFileSync("docker", [...base, container, "pg_dump", "-U", "postgres", "--no-owner", "--no-privileges", sourceName], options);
    execFileSync("docker", [...base, "-i", container, "psql", "-X", "-q", "-U", "postgres", "-d", restoredName, "-v", "ON_ERROR_STOP=1"], { ...options, input: dump });
    expect(await contents(restored)).toEqual(before);
    await expect(assertMigrations(restored)).rejects.toThrow("pending"); // Startup cannot auto-migrate.
    await migrateDatabase(restored); await assertMigrations(restored);
    expect(await contents(restored)).toEqual(before); expect(await contents(source)).toEqual(before);
    expect((await restored.query("select id from drizzle.__drizzle_migrations")).rowCount).toBe(4);
    for (const table of ["collaboration_state", "edit_leases", "workspace_events"]) expect((await restored.query(`select * from ${escapeIdentifier(table)}`)).rowCount).toBe(0);
    expect((await restored.query<{ value: unknown }>("select value from view_preferences")).rows[0]?.value).toEqual(view);
  } finally {
    await source?.end(); await restored?.end();
    await admin.query(`drop database if exists ${escapeIdentifier(restoredName)} with (force)`); await admin.query(`drop database if exists ${escapeIdentifier(sourceName)} with (force)`);
    await admin.end(); await rm(folder, { recursive: true, force: true });
  }
}, 30_000);
