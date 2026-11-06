import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool, escapeIdentifier, escapeLiteral } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { createApp } from "../app";
import { readConfig } from "../config";
import { MemoryMailer } from "../mailer";
import { assertMigrations, migrateDatabase } from "../db/migrate";
import { bootstrapOwner } from "../access";
import { connect } from "../db/connection";
import { WORKSPACE_ID } from "../../src/domain/v2/model";
import { dateOnlySchema } from "../../src/domain/schema";
import type { Snapshot } from "../../src/domain/v2/model";
import type { ContentCommand } from "../../src/domain/v2/commands";
import type { CommandResult } from "../commands";
import { hashPayload } from "../commands";
import { tokenHash } from "../members";
import { teamSchema, guestLinksSchema } from "../../src/application/v2/accessContracts";

const origin = "https://timeline.test";
const password = "Temporary test password 2026!";
const ownerEmail = "owner@example.test";
const appRole = `timeline_test_${randomBytes(8).toString("hex")}`;
let admin: Pool;
let runtimeUrl: string;
let runtime: Awaited<ReturnType<typeof createApp>>;
let mailer: MemoryMailer;
let ownerCookie: string;
let ownerId: string;
let ownerSetCookie: string;
const addresses = new Map<string, string>();
const secret = randomBytes(48).toString("base64url");
const configuration = (url: string) => readConfig({ DATABASE_URL: url, BETTER_AUTH_SECRET: secret, APP_ORIGIN: origin, NODE_ENV: "test", MAILER_MODE: "memory" });

type Response = Awaited<ReturnType<typeof request>>;
function request(method: "GET" | "POST" | "PUT" | "DELETE", url: string, cookie = "", payload?: object, extraHeaders: Record<string, string> = {}) {
  const key = payload && "email" in payload && typeof payload.email === "string" ? payload.email : cookie;
  if (key && !addresses.has(key)) addresses.set(key, `192.0.2.${String(addresses.size + 1)}`);
  return runtime.app.inject({ method, url, remoteAddress: addresses.get(key) ?? "127.0.0.1", headers: { origin, cookie, ...extraHeaders }, ...(payload ? { payload } : {}) });
}
function cookieOf(response: Response) {
  const values = response.headers["set-cookie"];
  return (Array.isArray(values) ? values : [values ?? ""]).map((v) => v.split(";")[0]).join("; ");
}
async function register(email: string, verify = true) {
  const signup = await request("POST", "/api/auth/sign-up/email", "", { name: "Test user", email, password });
  expect(signup.statusCode, signup.body).toBe(200);
  if (verify) {
    const message = mailer.messages.findLast((m) => m.to === email && m.subject.includes("подтверждение"));
    expect(message).toBeDefined();
    const url = new URL(message?.text ?? "");
    const response = await request("GET", `${url.pathname}${url.search}`);
    expect([200, 302]).toContain(response.statusCode);
  }
  const login = await request("POST", "/api/auth/sign-in/email", "", { email, password });
  if (!verify) { expect(login.statusCode).toBe(403); return ""; }
  expect(login.statusCode, login.body).toBe(200);
  const cookie = cookieOf(login);
  addresses.set(cookie, addresses.get(email) ?? "127.0.0.1");
  if (email === ownerEmail) ownerSetCookie = String(login.headers["set-cookie"]);
  return cookie;
}
async function bootstrap() {
  const operator = connect(admin.options.connectionString ?? "");
  try { return await operator.db.transaction((db) => bootstrapOwner(db, ownerEmail)); }
  finally { await operator.pool.end(); }
}
async function workspace() {
  const response = await request("GET", "/api/v1/workspaces/current", ownerCookie);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ workspace: { revision: number; peopleRevision: number } }>().workspace;
}
async function create(name = "Server project") {
  const { revision } = await workspace();
  const input = { commandId: randomUUID(), version: 1, workspaceId: WORKSPACE_ID, expectedRevision: revision, name, description: "Private project description", startDate: "2026-11-01" };
  const response = await request("POST", "/api/v1/projects", ownerCookie, input);
  expect(response.statusCode, response.body).toBe(200);
  return { input, result: response.json<CommandResult>() };
}
async function read(id: string, cookie = ownerCookie) {
  const response = await request("GET", `/api/v1/projects/${id}`, cookie);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<Snapshot>();
}
function envelope(d: Snapshot, command: ContentCommand) {
  return { commandId: randomUUID(), version: 1, workspaceId: WORKSPACE_ID, projectId: d.project.id, expectedRevision: d.project.revision, command };
}
async function execute(d: Snapshot, command: ContentCommand) {
  const response = await request("POST", `/api/v1/projects/${d.project.id}/commands`, ownerCookie, envelope(d, command));
  expect(response.statusCode, response.body).toBe(200);
  return read(d.project.id);
}
async function invite(email: string, cookie = ownerCookie) {
  const response = await request("POST", "/api/v1/invitations", cookie, { email });
  expect(response.statusCode, response.body).toBe(200);
  const message = mailer.messages.findLast((m) => m.to === email && m.subject.includes("приглашение"));
  return { id: response.json<{ id: string }>().id, token: new URL(message?.text ?? "").hash.slice(1) };
}
async function accept(cookie: string, token: string) { return request("POST", "/api/v1/invitations/accept", cookie, { token }); }

describe("real PostgreSQL command and security boundary", () => {
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith("_test")) throw Error("TEST_DATABASE_URL must name an isolated *_test database; its test data will be cleared");
    admin = new Pool({ connectionString: url });
    await migrateDatabase(admin);
    await migrateDatabase(admin); // Explicit idempotent migration acceptance.
    await assertMigrations(admin);
    const appPassword = randomBytes(32).toString("base64url");
    await admin.query(`create role ${escapeIdentifier(appRole)} login password ${escapeLiteral(appPassword)} nosuperuser nocreatedb nocreaterole nobypassrls`);
    await admin.query(`grant usage on schema public, drizzle to ${escapeIdentifier(appRole)}`);
    await admin.query(`grant select, insert, update, delete on all tables in schema public to ${escapeIdentifier(appRole)}`);
    await admin.query(`grant select on all tables in schema drizzle to ${escapeIdentifier(appRole)}`);
    const appUrl = new URL(url); appUrl.username = appRole; appUrl.password = appPassword; runtimeUrl = appUrl.toString();
  });
  beforeEach(async () => {
    // Only the explicitly named dedicated test DB, never DATABASE_URL or local user data.
    await admin.query("truncate table auth_users, auth_verifications, auth_rate_limits cascade");
    addresses.clear();
    mailer = new MemoryMailer(); runtime = await createApp(configuration(runtimeUrl), mailer);
    ownerCookie = await register(ownerEmail);
    ownerId = z.object({ user: z.object({ id: z.string() }) }).parse((await request("GET", "/api/auth/get-session", ownerCookie)).json<unknown>()).user.id;
    await bootstrap();
  });
  afterEach(async () => { await runtime.app.close(); });
  afterAll(async () => {
    await admin.query(`drop owned by ${escapeIdentifier(appRole)}`);
    await admin.query(`drop role ${escapeIdentifier(appRole)}`);
    await admin.end();
  });

  it("V1.6A.1 persists activity and atomic boundary commands with receipts, conflicts and rollback", async () => {
    const { result } = await create(), d = await read(result.projectId ?? ""), url = `/api/v1/projects/${d.project.id}/commands`;
    const e = envelope(d, { type: "ResizeProjectRange", startDate: "2026-11-03" as Snapshot["project"]["startDate"], endDateExclusive: "2026-11-10" as Snapshot["project"]["startDate"], effect: "clip" });
    const response = await request("POST", url, ownerCookie, e);
    expect(response.statusCode, response.body).toBe(200);
    expect((await request("POST", url, ownerCookie, e)).json<unknown>()).toEqual(response.json<unknown>());
    const after = await read(d.project.id);
    // SQL task ordering is not a business invariant: assert against stable IDs.
    const inside = d.tasks.find((t) => t.startDate >= "2026-11-03" && t.endDateExclusive <= "2026-11-10");
    const outsideTask = d.tasks.find((t) => t.endDateExclusive <= "2026-11-03" || t.startDate >= "2026-11-10");
    expect(inside).toBeDefined();
    expect(outsideTask).toBeDefined();
    expect(after.tasks.find((t) => t.id === inside?.id)).toMatchObject({ isActive: true, startDate: inside?.startDate, endDateExclusive: inside?.endDateExclusive });
    expect(after.tasks.find((t) => t.id === outsideTask?.id)).toMatchObject({ isActive: false, startDate: outsideTask?.startDate, endDateExclusive: outsideTask?.endDateExclusive });
    expect(after.project.revision).toBe(1);
    expect((await request("POST", url, ownerCookie, { ...e, commandId: randomUUID() })).statusCode).toBe(409);
    expect((await request("POST", url, ownerCookie, { ...e, command: { ...e.command, effect: "deactivate" } })).statusCode).toBe(409);
    const p = after.processes[0]; expect(p).toBeDefined();
    const off = await execute(after, { type: "SetWorkActive", kind: "process", id: p?.id ?? "", value: false });
    const outside = await execute(off, { type: "ResizeWorkRange", kind: "process", id: p?.id ?? "", startDate: dateOnlySchema.parse("2026-10-01"), endDateExclusive: dateOnlySchema.parse("2026-10-03") });
    expect((await request("POST", url, ownerCookie, envelope(outside, { type: "SetWorkActive", kind: "process", id: p?.id ?? "", value: true }))).statusCode).toBe(422);
    const pending = envelope(outside, { type: "ResizeProjectRange", startDate: dateOnlySchema.parse("2026-11-04"), endDateExclusive: dateOnlySchema.parse("2026-11-09"), effect: "deactivate" });
    await admin.query("create function test_activity_fail() returns trigger language plpgsql as $$ begin raise exception 'activity rollback'; end $$");
    await admin.query("create trigger test_activity_fail before insert on audit_events for each row execute function test_activity_fail()");
    try {
      expect((await request("POST", url, ownerCookie, pending)).statusCode).toBe(500);
      expect(await read(d.project.id)).toEqual(outside);
      expect((await admin.query("select command_id from command_receipts where command_id = $1", [pending.commandId])).rowCount).toBe(0);
    } finally { await admin.query("drop trigger test_activity_fail on audit_events"); await admin.query("drop function test_activity_fail()"); }
    expect((await request("POST", url, ownerCookie, pending)).statusCode).toBe(200);
    await runtime.app.close(); mailer = new MemoryMailer(); runtime = await createApp(configuration(runtimeUrl), mailer);
    expect((await read(d.project.id)).processes.find((w) => w.id === p?.id)).toMatchObject({ isActive: false, startDate: "2026-10-01" });
  });

  it("starts an actual HTTP listener; migrations are versioned and app role cannot perform DDL", async () => {
    const address = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
    expect((await fetch(`${address}/health/live`)).status).toBe(200);
    expect((await fetch(`${address}/health/ready`)).status).toBe(200);
    await expect(runtime.pool.query("create table forbidden_ddl(id int)")).rejects.toMatchObject({ code: "42501" });
    const original = await admin.query<{ id: number; hash: string }>("select id, hash from drizzle.__drizzle_migrations order by id limit 1");
    const migration = original.rows[0]; expect(migration).toBeDefined();
    try {
      await admin.query("update drizzle.__drizzle_migrations set hash = 'tampered' where id = $1", [migration?.id]);
      await expect(migrateDatabase(admin)).rejects.toThrow("mismatch");
      expect((await request("GET", "/health/ready")).statusCode).toBe(503);
      await expect(createApp(configuration(runtimeUrl))).rejects.toThrow("mismatch");
    } finally { await admin.query("update drizzle.__drizzle_migrations set hash = $1 where id = $2", [migration?.hash, migration?.id]); }
    expect((await request("GET", "/health/ready")).statusCode).toBe(200);
    await expect(createApp(configuration(admin.options.connectionString ?? ""))).rejects.toThrow("restricted");
  });

  it("requires verified sessions, explicit bootstrap and membership; sends safe HTTPS cookies", async () => {
    expect(await bootstrap()).toBe(WORKSPACE_ID);
    expect((await request("GET", "/api/v1/projects")).statusCode).toBe(401);
    const outsider = await register("outsider@example.test");
    expect((await request("GET", "/api/v1/projects", outsider)).statusCode).toBe(403);
    expect((await request("GET", "/api/v1/workspaces/current", outsider)).statusCode).toBe(403);
    await register("unverified@example.test", false);
    const operator = connect(admin.options.connectionString ?? "");
    try {
      await expect(operator.db.transaction((tx) => bootstrapOwner(tx, "unverified@example.test"))).rejects.toMatchObject({ code: "VERIFIED_USER_REQUIRED" });
      await expect(operator.db.transaction((tx) => bootstrapOwner(tx, "outsider@example.test"))).rejects.toMatchObject({ code: "OWNER_ALREADY_BOOTSTRAPPED" });
    } finally { await operator.pool.end(); }
    const cookies = ownerSetCookie;
    expect(cookies).toContain("HttpOnly"); expect(cookies).toContain("Secure"); expect(cookies).toMatch(/SameSite=Lax/i);
    const stored = await admin.query<{ password: string }>("select password from auth_accounts where user_id = $1", [ownerId]);
    expect(stored.rows[0]?.password).not.toBe(password);
  });

  it("rejects CSRF, forged actor/snapshots, excessive content and hostile origins", async () => {
    const { result } = await create(), d = await read(result.projectId ?? "");
    const input = envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "No" });
    for (const headers of [{ origin: "https://attacker.test" }, { origin: "" }, { "sec-fetch-site": "cross-site" }]) {
      expect((await request("POST", `/api/v1/projects/${d.project.id}/commands`, ownerCookie, input, headers)).statusCode).toBe(403);
    }
    expect((await request("POST", `/api/v1/projects/${d.project.id}/commands`, ownerCookie, { ...input, actorId: randomUUID() })).statusCode).toBe(400);
    expect((await request("POST", `/api/v1/projects/${d.project.id}/commands`, ownerCookie, { ...input, snapshot: d })).statusCode).toBe(400);
    expect((await request("POST", "/api/v1/projects", ownerCookie, { text: "x".repeat(270_000) })).statusCode).toBe(413);
    expect((await request("POST", "/api/v1/projects", ownerCookie, { text: "x".repeat(20_001) })).statusCode).toBe(400);
    expect((await read(d.project.id)).project.revision).toBe(0);
  });

  it("persists commands and reads legacy views without any new SQL presentation writes", async () => {
    const { result } = await create(); let d = await read(result.projectId ?? "");
    expect(d.stages).toHaveLength(2); expect(d.processes).toHaveLength(4); expect(d.tasks).toHaveLength(8);
    d = await execute(d, { type: "Rename", kind: "project", id: d.project.id, value: "Persisted" });
    d = await execute(d, { type: "ShiftProject", days: 3 });
    d = await execute(d, { type: "SetCheckpointTiming", id: d.checkpoints[0]?.id ?? "", timing: { anchor: "free", date: dateOnlySchema.parse("2026-11-22") } });
    const process = d.processes[0]; expect(process).toBeDefined();
    d = await execute(d, { type: "SetWorkStatus", kind: "process", id: process?.id ?? "", status: "В работе" });
    d = await execute(d, { type: "Rename", kind: "task", id: d.tasks[0]?.id ?? "", value: "Changed task" });
    expect((await admin.query<{ count: string }>("select count(*) from view_preferences where scope=$1", [`project:${d.project.id}`])).rows[0]?.count).toBe("0");
    const view = { ...d.viewPreferences, zoomPxPerDay: 60 };
    await admin.query("insert into view_preferences(workspace_id,user_id,scope,value) values($1,$2,$3,$4)", [WORKSPACE_ID, ownerId, `project:${d.project.id}`, JSON.stringify(view)]);
    const legacy = await request("PUT", `/api/v1/projects/${d.project.id}/view`, ownerCookie, { workspaceId: WORKSPACE_ID, value: { ...view, zoomPxPerDay: 72 } });
    expect(legacy.statusCode).toBe(200); expect(legacy.headers.deprecation).toBe("true");
    expect(legacy.json<{ value: { zoomPxPerDay: number } }>().value.zoomPxPerDay).toBe(72);
    expect((await admin.query<{ value: { zoomPxPerDay: number } }>("select value from view_preferences where scope=$1", [`project:${d.project.id}`])).rows[0]?.value.zoomPxPerDay).toBe(60);
    const summary = (await request("GET", "/api/v1/projects?limit=1", ownerCookie)).json<{ projects: object[]; nextOffset: number }>();
    expect(Object.keys(summary.projects[0] ?? {})).toEqual(["project"]); expect(summary.nextOffset).toBe(1);
    const revision = d.project.revision;
    await runtime.app.close(); mailer = new MemoryMailer(); runtime = await createApp(configuration(runtimeUrl), mailer);
    const saved = await read(d.project.id);
    expect(saved.project.name).toBe("Persisted"); expect(saved.project.revision).toBe(revision); expect(saved.viewPreferences.zoomPxPerDay).toBe(60);
    expect(saved.checkpoints[0]?.timing).toEqual({ anchor: "free", date: "2026-11-22" });
    expect(saved.processes.find((p) => p.id === process?.id)?.status).toBe("В работе");
    expect(saved.project.startDate).toBe("2026-11-04");
    const normalized = await admin.query<{ count: string }>("select count(*) from stages where project_id = $1", [d.project.id]); expect(normalized.rows[0]?.count).toBe("2");
  });

  it("replays one receipt, rejects reused IDs and serializes competing revisions without overwrites", async () => {
    const { input, result } = await create();
    expect((await request("POST", "/api/v1/projects", ownerCookie, input)).json<unknown>()).toEqual(result);
    const d = await read(result.projectId ?? ""), url = `/api/v1/projects/${d.project.id}/commands`;
    const e = envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "Once" });
    const [a, b] = await Promise.all([request("POST", url, ownerCookie, e), request("POST", url, ownerCookie, e)]);
    expect(a.statusCode).toBe(200); expect(b.json<unknown>()).toEqual(a.json<unknown>());
    expect((await request("POST", url, ownerCookie, { ...e, command: { ...e.command, value: "Different" } })).statusCode).toBe(409);
    const current = await read(d.project.id);
    const [left, right] = await Promise.all([request("POST", url, ownerCookie, envelope(current, { type: "ShiftProject", days: 1 })), request("POST", url, ownerCookie, envelope(current, { type: "ShiftProject", days: 2 }))]);
    expect([left.statusCode, right.statusCode].sort()).toEqual([200, 409]);
    const saved = await read(d.project.id); expect(saved.project.revision).toBe(2);
    const noop = await request("POST", url, ownerCookie, envelope(saved, { type: "Rename", kind: "project", id: d.project.id, value: "Once" }));
    expect(noop.json<CommandResult>().changed).toBe(false); expect((await read(d.project.id)).project.revision).toBe(2);
    const receipts = await admin.query<{ count: string }>("select count(*) from command_receipts where command_id = $1", [e.commandId]); expect(receipts.rows[0]?.count).toBe("1");
  });

  it("rolls back children, revision, receipt and audit on a late SQL error", async () => {
    const { result } = await create(), d = await read(result.projectId ?? ""), e = envelope(d, { type: "ShiftProject", days: 9 });
    await admin.query("create function test_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'forced test failure'; end $$");
    await admin.query("create trigger test_fail_audit before insert on audit_events for each row execute function test_fail_audit()");
    try {
      const response = await request("POST", `/api/v1/projects/${d.project.id}/commands`, ownerCookie, e);
      expect(response.statusCode).toBe(500); expect(response.body).not.toContain("forced"); expect(response.body).not.toContain("SQL");
      expect(await read(d.project.id)).toEqual(d);
      expect((await admin.query("select command_id from command_receipts where command_id = $1", [e.commandId])).rowCount).toBe(0);
    } finally { await admin.query("drop trigger test_fail_audit on audit_events"); await admin.query("drop function test_fail_audit()"); }
    expect((await request("POST", `/api/v1/projects/${d.project.id}/commands`, ownerCookie, e)).statusCode).toBe(200);
  });

  it("blocks foreign workspace/project data at API and composite foreign keys", async () => {
    const { result } = await create(), d = await read(result.projectId ?? ""), foreign = randomUUID();
    const outsider = await register("foreign@example.test");
    const outsiderId = (await admin.query<{ id: string }>("select id from auth_users where email = 'foreign@example.test'")).rows[0]?.id ?? "";
    await admin.query("insert into workspaces(id, name, owner_user_id) values ($1, 'Foreign', $2)", [foreign, outsiderId]);
    await admin.query("insert into workspace_memberships(workspace_id,user_id,role) values ($1,$2,'owner')", [foreign, outsiderId]);
    const wrong = await request("GET", `/api/v1/projects/${d.project.id}`, outsider); expect(wrong.statusCode).toBe(403); expect(wrong.body).not.toContain(d.project.name);
    expect((await request("GET", `/api/v1/projects?workspaceId=${foreign}`, ownerCookie)).statusCode).toBe(403);
    expect((await request("GET", `/api/v1/projects/${d.project.id}?workspaceId=${foreign}`, outsider)).statusCode).toBe(404);
    const e = { ...envelope(d, { type: "ShiftProject", days: 1 }), workspaceId: foreign };
    expect((await request("POST", `/api/v1/projects/${d.project.id}/commands`, outsider, e)).statusCode).toBe(404);
    await expect(admin.query("insert into stages (id,workspace_id,project_id,title,description,start_date,end_date_exclusive,sort_index) values ($1,$2,$3,'X','','2026-11-01','2026-11-02',99)", [randomUUID(), foreign, d.project.id])).rejects.toMatchObject({ code: "23503" });
    await expect(admin.query("update tasks set process_id = $1 where id = $2", [randomUUID(), d.tasks[0]?.id])).rejects.toMatchObject({ code: "23503" });
    expect((await read(d.project.id)).project.revision).toBe(0);
  });

  it("creates people/assignments atomically and preserves retired identity after archival", async () => {
    const { result } = await create(); let d = await read(result.projectId ?? "");
    const personId = randomUUID(), assignmentId = randomUUID();
    d = await execute(d, { type: "CreatePersonAndAssign", id: assignmentId, kind: "process", targetId: d.processes[0]?.id ?? "", personId, fields: { firstName: "Мария", lastName: "Тест", defaultRole: "Лид", contacts: "Private contact", note: "Private note" }, roleLabel: "Лид" });
    expect(d.assignments[0]?.personId).toBe(personId);
    const { peopleRevision } = await workspace();
    const archive = await request("POST", "/api/v1/people/commands", ownerCookie, { commandId: randomUUID(), workspaceId: WORKSPACE_ID, expectedRevision: peopleRevision, command: { type: "ArchivePerson", id: personId } });
    expect(archive.statusCode, archive.body).toBe(200);
    const catalog = (await request("GET", "/api/v1/people", ownerCookie)).json<{ people: { id: string; linkedUserId: string | null; archivedAt: string | null }[]; retiredAssignments: { nameSnapshot: string; assignmentId: string }[] }>();
    expect(catalog.people[0]?.linkedUserId).toBeNull(); expect(catalog.people[0]?.archivedAt).toBeTruthy(); expect(catalog.retiredAssignments[0]).toMatchObject({ assignmentId, nameSnapshot: "Мария Тест" });
    const before = await read(d.project.id);
    const failed = envelope(before, { type: "CreatePersonAndAssign", id: randomUUID(), kind: "task", targetId: randomUUID(), personId: randomUUID(), fields: { firstName: "Rollback", lastName: "", defaultRole: "", contacts: "", note: "" }, roleLabel: "" });
    expect((await request("POST", `/api/v1/projects/${d.project.id}/commands`, ownerCookie, failed)).statusCode).toBe(422);
    expect((await admin.query("select id from people where first_name = 'Rollback'")).rowCount).toBe(0);
  });

  it("archives, restores, duplicates and reorders projects without changing dates; enforces limits", async () => {
    const a = await create("First"), b = await create("Second"), d = await read(a.result.projectId ?? "");
    async function command(c: object) {
      const { revision } = await workspace(); return request("POST", "/api/v1/workspace/commands", ownerCookie, { commandId: randomUUID(), version: 1, workspaceId: WORKSPACE_ID, expectedRevision: revision, command: c });
    }
    expect((await command({ type: "ReorderProjects", order: [d.project.id, b.result.projectId] })).statusCode).toBe(200);
    expect((await read(d.project.id)).project.startDate).toBe(d.project.startDate);
    await admin.query("update workspaces set max_projects = 2 where id = $1", [WORKSPACE_ID]);
    const rev = (await workspace()).revision;
    expect((await request("POST", "/api/v1/projects", ownerCookie, { ...a.input, commandId: randomUUID(), expectedRevision: rev })).statusCode).toBe(409);
    expect((await command({ type: "ArchiveProject", id: d.project.id, archived: true })).statusCode).toBe(200);
    expect((await request("POST", `/api/v1/projects/${d.project.id}/commands`, ownerCookie, envelope(await read(d.project.id), { type: "ShiftProject", days: 1 }))).statusCode).toBe(409);
    expect((await command({ type: "ArchiveProject", id: d.project.id, archived: false })).statusCode).toBe(200);
    await admin.query("update workspaces set max_projects = 40 where id = $1", [WORKSPACE_ID]);
    const copy = await command({ type: "DuplicateProject", id: d.project.id, expectedProjectRevision: (await read(d.project.id)).project.revision });
    expect(copy.statusCode, copy.body).toBe(200);
    const duplicate = await read(copy.json<CommandResult>().projectId ?? "");
    expect(duplicate.project.startDate).toBe(d.project.startDate); expect(duplicate.processes[0]?.id).not.toBe(d.processes[0]?.id);
  });

  it("binds invitations to verified email, consumes once and applies membership revocation immediately", async () => {
    const memberEmail = "admin@example.test", member = await register(memberEmail), wrong = await register("wrong@example.test");
    const invitation = await invite(memberEmail);
    expect((await accept(wrong, invitation.token)).statusCode).toBe(403);
    expect((await accept(member, invitation.token)).statusCode).toBe(200);
    expect((await accept(member, invitation.token)).statusCode).toBe(403);
    const id = (await admin.query<{ id: string }>("select id from auth_users where email = $1", [memberEmail])).rows[0]?.id ?? "";
    const { result } = await create();
    expect((await request("GET", `/api/v1/projects/${result.projectId ?? ""}`, member)).statusCode).toBe(200);
    expect((await request("DELETE", `/api/v1/members/${ownerId}`, member)).statusCode).toBe(403);
    expect((await request("DELETE", `/api/v1/members/${ownerId}`, ownerCookie)).statusCode).toBe(403);
    const outstanding = await invite("later@example.test", member);
    const memberLink = (await request("POST", `/api/v1/projects/${result.projectId ?? ""}/guest-links`, member)).json<{ id: string; url: string }>();
    const guestSession = await request("POST", "/api/v1/guest/exchange", "", { token: new URL(memberLink.url).hash.slice(1) });
    expect(guestSession.statusCode).toBe(200);
    let project = await read(result.projectId ?? ""); const personId = randomUUID(), assignmentId = randomUUID();
    project = await execute(project, { type: "CreatePersonAndAssign", id: assignmentId, kind: "process", targetId: project.processes[0]?.id ?? "", personId, fields: { firstName: "Исполнитель", lastName: "", defaultRole: "Лид", contacts: "private fixture contact", note: "" }, roleLabel: "Лид" });
    await admin.query("update people set linked_user_id=$1 where id=$2", [id, personId]);
    expect((await request("DELETE", `/api/v1/members/${id}`, ownerCookie)).statusCode).toBe(200);
    expect((await read(project.project.id)).assignments).toEqual(project.assignments);
    const people = (await request("GET", "/api/v1/people", ownerCookie)).json<{ people: { id: string; linkedUserId: string | null; archivedAt: string | null }[] }>().people;
    expect(people).toContainEqual(expect.objectContaining({ id: personId, linkedUserId: id, archivedAt: null }));
    expect((await request("GET", "/api/v1/projects", member)).statusCode).toBe(403);
    expect((await request("GET", "/api/v1/guest/project", cookieOf(guestSession))).statusCode).toBe(403);
    expect(guestLinksSchema.parse((await request("GET", `/api/v1/projects/${project.project.id}/guest-links`, ownerCookie)).json<unknown>()).links[0]?.status).toBe("revoked");
    const later = await register("later@example.test"); expect((await accept(later, outstanding.token)).statusCode).toBe(403);
    const stored = await admin.query<{ token_hash: string }>("select token_hash from workspace_invitations where id = $1", [invitation.id]);
    expect(stored.rows[0]?.token_hash).toBe(tokenHash("invite", invitation.token)); expect(stored.rows[0]?.token_hash).not.toContain(invitation.token);
    const revoked = await invite("revoked@example.test"); await request("DELETE", `/api/v1/invitations/${revoked.id}`, ownerCookie);
    expect((await accept(await register("revoked@example.test"), revoked.token)).statusCode).toBe(403);
  });

  it("checks editor limits atomically when two outstanding invites compete for the last place", async () => {
    await admin.query("update workspaces set max_editors = 2 where id = $1", [WORKSPACE_ID]);
    const left = await register("left@example.test"), right = await register("right@example.test");
    const a = await invite("left@example.test"), b = await invite("right@example.test");
    const accepted = await Promise.all([accept(left, a.token), accept(right, b.token)]);
    expect(accepted.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await admin.query("select user_id from workspace_memberships where revoked_at is null")).rowCount).toBe(2);
  });

  it("V2.1A exposes scoped token-free team/link lists, seven-day statuses and the default four-editor limit", async () => {
    const outsider = await register("outside-team@example.test");
    await register("unverified-team@example.test", false);
    expect((await request("GET", "/api/v1/team", outsider)).statusCode).toBe(403);
    expect((await request("GET", "/api/v1/team")).statusCode).toBe(401);
    expect((await request("POST", "/api/v1/invitations", outsider, { email: "nobody@example.test" })).statusCode).toBe(403);
    const { result } = await create(), id = result.projectId ?? "";
    expect((await request("GET", `/api/v1/projects/${id}/guest-links`, outsider)).statusCode).toBe(403);
    expect((await request("POST", `/api/v1/projects/${id}/guest-links`, outsider)).statusCode).toBe(403);
    expect((await request("GET", `/api/v1/projects/${id}/guest-links?workspaceId=${randomUUID()}`, ownerCookie)).statusCode).toBe(403);
    expect((await request("GET", `/api/v1/projects/${randomUUID()}/guest-links`, ownerCookie)).statusCode).toBe(404);
    const another = await create("Other project");
    expect(guestLinksSchema.parse((await request("GET", `/api/v1/projects/${another.result.projectId ?? ""}/guest-links`, ownerCookie)).json<unknown>()).links).toEqual([]);
    const stale = await invite("stale-team@example.test"), staleCookie = await register("stale-team@example.test");
    const before = teamSchema.parse((await request("GET", "/api/v1/team", ownerCookie)).json<unknown>());
    const pending = before.invitations.find((i) => i.id === stale.id);
    expect(pending?.status).toBe("pending"); expect(new Date(pending?.expiresAt ?? "").getTime() - Date.now()).toBeGreaterThan(6.99 * 86_400_000);
    await admin.query("update workspace_invitations set expires_at=now()-interval '1 second' where id=$1", [stale.id]);
    expect((await accept(staleCookie, stale.token)).statusCode).toBe(403);
    expect((await accept("", stale.token)).statusCode).toBe(401);
    for (let n = 0; n < 3; n++) {
      const email = `team-${String(n)}@example.test`, cookie = await register(email), invitation = await invite(email);
      expect((await accept(cookie, invitation.token)).statusCode).toBe(200);
      const response = await request("GET", "/api/v1/team", cookie), team = teamSchema.parse(response.json<unknown>());
      expect(team.role).toBe("admin"); expect(team.limits).toEqual({ editors: 4, guests: 6 });
      expect(team.invitations.find((i) => i.id === invitation.id)?.status).toBe("used");
      expect(team.invitations.find((i) => i.id === stale.id)?.status).toBe("expired");
      expect(response.body).not.toContain(invitation.token); expect(response.body).not.toMatch(/tokenHash|token_hash|password|contacts|note|session/);
      if (n === 0) {
        const cancelled = await invite("cancelled-by-admin@example.test");
        expect((await request("DELETE", `/api/v1/invitations/${cancelled.id}`, cookie)).statusCode).toBe(200);
        expect(teamSchema.parse((await request("GET", "/api/v1/team", cookie)).json<unknown>()).invitations.find((i) => i.id === cancelled.id)?.status).toBe("revoked");
        const issued = (await request("POST", `/api/v1/projects/${id}/guest-links`, cookie)).json<{ id: string; url: string }>();
        const metadata = await request("GET", `/api/v1/projects/${id}/guest-links`, ownerCookie);
        expect(guestLinksSchema.parse(metadata.json<unknown>()).links).toEqual([{ id: issued.id, projectId: id, permissions: "read", status: "active" }]);
        expect(metadata.body).not.toContain(new URL(issued.url).hash.slice(1)); expect(metadata.body).not.toMatch(/token|email|creator/);
        await request("DELETE", `/api/v1/guest-links/${issued.id}`, cookie);
        expect(guestLinksSchema.parse((await request("GET", `/api/v1/projects/${id}/guest-links`, cookie)).json<unknown>()).links[0]?.status).toBe("revoked");
      }
    }
    expect(teamSchema.parse((await request("GET", "/api/v1/team", ownerCookie)).json<unknown>()).members).toHaveLength(4);
    expect((await request("POST", "/api/v1/invitations", ownerCookie, { email: "fifth@example.test" })).statusCode).toBe(409);
  });

  it("verifies email and resets passwords through mailer; reset invalidates the previous session", async () => {
    const response = await request("POST", "/api/auth/request-password-reset", "", { email: ownerEmail, redirectTo: `${origin}/reset` }); expect(response.statusCode, response.body).toBe(200);
    const message = mailer.messages.findLast((m) => m.to === ownerEmail && m.subject.includes("восстановление"));
    const resetUrl = new URL(message?.text ?? ""), redirect = await request("GET", `${resetUrl.pathname}${resetUrl.search}`);
    expect(redirect.statusCode).toBe(302);
    const token = new URL(String(redirect.headers.location)).searchParams.get("token"); expect(token).toBeTruthy();
    const changed = await request("POST", "/api/auth/reset-password", "", { token, newPassword: "Replacement temporary password 2026!" }); expect(changed.statusCode, changed.body).toBe(200);
    expect((await request("GET", "/api/v1/projects", ownerCookie)).statusCode).toBe(401);
    expect((await request("POST", "/api/auth/sign-in/email", "", { email: ownerEmail, password })).statusCode).toBe(401);
    expect((await request("POST", "/api/auth/sign-in/email", "", { email: ownerEmail, password: "Replacement temporary password 2026!" })).statusCode).toBe(200);
    expect((await request("POST", "/api/auth/reset-password", "", { token, newPassword: password })).statusCode).not.toBe(200);
  });

  it("exchanges purpose-scoped guest tokens for a limited read-only session and honors revocation", async () => {
    const { result } = await create(), id = result.projectId ?? "";
    const issued = await request("POST", `/api/v1/projects/${id}/guest-links`, ownerCookie);
    expect(issued.statusCode).toBe(200);
    const link = issued.json<{ id: string; url: string }>(), token = new URL(link.url).hash.slice(1);
    expect((await accept(ownerCookie, token)).statusCode).toBe(403);
    const invitation = await invite("guestwrong@example.test");
    expect((await request("POST", "/api/v1/guest/exchange", "", { token: invitation.token })).statusCode).toBe(403);
    const exchange = await request("POST", "/api/v1/guest/exchange", "", { token }); expect(exchange.statusCode).toBe(200);
    const cookie = cookieOf(exchange), view = await request("GET", "/api/v1/guest/project", cookie); expect(view.statusCode, view.body).toBe(200);
    for (const excluded of ["assignments", "people", "contacts", "description", "creatorId", "workspaceId", "auth", "note"]) expect(view.body).not.toContain(`"${excluded}"`);
    expect((await request("GET", "/api/v1/projects", cookie)).statusCode).toBe(401);
    expect((await request("POST", `/api/v1/projects/${id}/commands`, cookie, envelope(await read(id), { type: "ShiftProject", days: 1 }))).statusCode).toBe(401);
    const sessions = [cookie];
    for (let n = 1; n < 6; n++) {
      const extra = await request("POST", "/api/v1/guest/exchange", "", { token }); expect(extra.statusCode).toBe(200); sessions.push(cookieOf(extra));
    }
    expect((await request("POST", "/api/v1/guest/exchange", "", { token })).statusCode).toBe(429);
    await admin.query("update guest_sessions set expires_at=now()-interval '1 second' where token_hash=$1", [tokenHash("guest-session", cookie.split("=")[1] ?? "")]);
    expect((await request("GET", "/api/v1/guest/project", cookie)).statusCode).toBe(401);
    expect((await request("POST", "/api/v1/guest/exchange", "", { token })).statusCode).toBe(200);
    expect((await request("DELETE", `/api/v1/guest-links/${link.id}`, ownerCookie)).statusCode).toBe(200);
    expect((await request("GET", "/api/v1/guest/project", sessions[1])).statusCode).toBe(403);
    expect((await request("POST", "/api/v1/guest/exchange", "", { token })).statusCode).toBe(403);
  });

  it("rate-limits sensitive HTTP routes without exposing supplied secrets", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await request("POST", "/api/auth/sign-in/email", "", { email: ownerEmail, password: "wrong" }, { "x-forwarded-for": `10.0.0.${String(i)}` })).statusCode);
    expect(statuses).toContain(429);
    expect((await request("GET", "/health/live")).statusCode).toBe(200);
  });
});

it("validates required configuration without reflecting secrets and hashes canonical command payloads", () => {
  expect(() => readConfig({ DATABASE_URL: "secret-marker", BETTER_AUTH_SECRET: "secret-marker", APP_ORIGIN: "invalid" })).toThrow("Invalid server settings");
  try { readConfig({ DATABASE_URL: "secret-marker" }); } catch (error) { expect(String(error)).not.toContain("secret-marker"); }
  expect(() => readConfig({ DATABASE_URL: "postgresql://localhost/db", BETTER_AUTH_SECRET: secret, APP_ORIGIN: "http://localhost:8080", NODE_ENV: "production" })).toThrow();
  expect(hashPayload({ b: 2, a: { z: 1 } })).toBe(hashPayload({ a: { z: 1 }, b: 2 }));
  expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: "1" }));
});
