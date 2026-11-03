import { expect, it } from "vitest";
import { Pool, escapeIdentifier } from "pg";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migrateDatabase } from "../db/migrate";

it("V1.6A.1 migration preserves existing SQL work and defaults old writes to active", async () => {
  const input = process.env.TEST_DATABASE_URL;
  if (!input || !new URL(input).pathname.endsWith("_test")) throw Error("An isolated TEST_DATABASE_URL ending in _test is required");
  const name = `timeline_activity_${randomUUID().replaceAll("-", "")}_test`, admin = new Pool({ connectionString: input });
  const folder = await mkdtemp(join(tmpdir(), "timeline-activity-migration-"));
  let pool: Pool | undefined;
  try {
    await admin.query(`create database ${escapeIdentifier(name)}`);
    const url = new URL(input); url.pathname = `/${name}`; pool = new Pool({ connectionString: url.toString() });
    const source = new URL("../db/migrations/", import.meta.url);
    const journal: { version: string; dialect: string; entries: { tag: string }[] } = JSON.parse(await readFile(new URL("meta/_journal.json", source), "utf8")) as { version: string; dialect: string; entries: { tag: string }[] };
    const entries = journal.entries.slice(0, 2);
    await mkdir(join(folder, "meta"));
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await copyFile(new URL(`${entry.tag}.sql`, source), join(folder, `${entry.tag}.sql`));
    await migrate(drizzle(pool), { migrationsFolder: folder });
    const [user, workspace, project, stage, lane, process, taskLane, task] = Array.from({ length: 8 }, () => randomUUID());
    await pool.query("insert into auth_users(id,name,email,email_verified) values($1,'Fixture','fixture@example.test',true)", [user]);
    await pool.query("insert into workspaces(id,name,owner_user_id) values($1,'Fixture',$2)", [workspace, user]);
    await pool.query("insert into projects(id,workspace_id,creator_id,name,anchor_date,start_date,end_date_exclusive,sort_index,created_at,updated_at) values($1,$2,$3,'Fixture','2026-11-01','2026-11-01','2026-11-10',0,now(),now())", [project, workspace, user]);
    await pool.query("insert into stages(id,workspace_id,project_id,title,description,start_date,end_date_exclusive,sort_index) values($1,$2,$3,'Stage','','2026-11-01','2026-11-10',0)", [stage, workspace, project]);
    await pool.query("insert into process_lanes(id,workspace_id,project_id,stage_id,sort_index) values($1,$2,$3,$4,0)", [lane, workspace, project, stage]);
    await pool.query("insert into processes(id,workspace_id,project_id,stage_id,lane_id,title,start_date,end_date_exclusive,status,color,sort_index) values($1,$2,$3,$4,$5,'Original','2026-11-01','2026-11-06','Пауза','#123456',0)", [process, workspace, project, stage, lane]);
    await pool.query("insert into task_lanes(id,workspace_id,project_id,process_id,sort_index) values($1,$2,$3,$4,0)", [taskLane, workspace, project, process]);
    await pool.query("insert into tasks(id,workspace_id,project_id,process_id,lane_id,title,start_date,end_date_exclusive,status,sort_index) values($1,$2,$3,$4,$5,'Original task','2026-11-01','2026-11-03','Готово',0)", [task, workspace, project, process, taskLane]);
    const before = (await pool.query("select * from processes")).rows as Record<string, unknown>[];
    await migrateDatabase(pool);
    expect((await pool.query("select * from processes")).rows).toEqual(before.map((row) => ({ ...row, is_active: true })));
    expect((await pool.query<{ is_active: boolean }>("select is_active from tasks")).rows[0]?.is_active).toBe(true);
    await pool.query("update tasks set is_active=false where id=$1", [task]);
    await migrateDatabase(pool);
    expect((await pool.query<{ is_active: boolean }>("select is_active from tasks")).rows[0]?.is_active).toBe(false);
    await expect(pool.query("update processes set is_active=null")).rejects.toMatchObject({ code: "23502" });
  } finally {
    await pool?.end();
    await admin.query(`drop database if exists ${escapeIdentifier(name)}`);
    await admin.end();
    await rm(folder, { recursive: true });
  }
});
