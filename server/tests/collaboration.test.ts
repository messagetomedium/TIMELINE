import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool, escapeIdentifier, escapeLiteral } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import { createApp } from "../app";
import { readConfig } from "../config";
import { MemoryMailer } from "../mailer";
import { connect } from "../db/connection";
import { migrateDatabase } from "../db/migrate";
import { bootstrapOwner } from "../access";
import { EVENT_RETENTION } from "../outbox";
import { WORKSPACE_ID, snapshotSchema } from "../../src/domain/v2/model";
import type { Snapshot } from "../../src/domain/v2/model";
import type { ContentCommand } from "../../src/domain/v2/commands";
import { changeSchema, cursorSchema, leasePreparedSchema } from "../../src/application/v2/collaborationContracts";
import type { LeaseProof } from "../../src/application/v2/collaborationContracts";
import { EventFrames } from "../../src/infrastructure/remote/RealtimeChannel";
import { addDays } from "../../src/domain";

const origin = "http://127.0.0.1:8080", password = "Disposable collaboration password 2026!", secret = randomBytes(48).toString("base64url");
const role = `timeline_collab_${randomBytes(8).toString("hex")}`;
let admin: Pool, runtimeUrl: string, runtime: Awaited<ReturnType<typeof createApp>>, mailer: MemoryMailer;
const streams = new Set<AbortController>(), children = new Set<ChildProcess>();
type Member = { cookie: string; email: string; id: string };
const config = (url: string) => readConfig({ DATABASE_URL: url, BETTER_AUTH_SECRET: secret, APP_ORIGIN: origin, NODE_ENV: "test", MAILER_MODE: "memory" });
let requestNumber = 0;
function api(method: "GET" | "POST" | "DELETE", url: string, cookie = "", payload?: object, headers: Record<string, string> = {}) {
  return runtime.app.inject({ method, url, remoteAddress: `192.0.2.${String(++requestNumber % 200 + 1)}`, headers: { origin, cookie, ...headers }, ...(payload ? { payload } : {}) });
}
async function register(email: string) {
  expect((await api("POST", "/api/auth/sign-up/email", "", { name: "Editor", email, password })).statusCode).toBe(200);
  const mail = mailer.messages.findLast((m) => m.to === email && m.subject.includes("подтверждение")); if (!mail) throw Error("Fixture mail missing");
  const url = new URL(mail.text); expect((await api("GET", url.pathname + url.search)).statusCode).toBe(302);
  const login = await api("POST", "/api/auth/sign-in/email", "", { email, password }); expect(login.statusCode).toBe(200);
  const cookies = login.headers["set-cookie"], cookie = (Array.isArray(cookies) ? cookies : [cookies ?? ""]).map((v) => v.split(";")[0]).join("; ");
  const user = (await admin.query<{ id: string }>("select id from auth_users where email=$1", [email])).rows[0]; if (!user) throw Error("Fixture user missing");
  return { cookie, email, id: user.id };
}
async function editors(count = 2) {
  const owner = await register("collaboration-owner@example.test"), operator = connect(admin.options.connectionString ?? "");
  try { await operator.db.transaction((tx) => bootstrapOwner(tx, owner.email)); } finally { await operator.pool.end(); }
  const members = [owner];
  for (let i = 1; i < count; i++) {
    const member = await register(`collaboration-${String(i)}@example.test`);
    expect((await api("POST", "/api/v1/invitations", owner.cookie, { email: member.email })).statusCode).toBe(200);
    const mail = mailer.messages.findLast((m) => m.to === member.email && m.subject.includes("приглашение")); if (!mail) throw Error("Fixture invite missing");
    expect((await api("POST", "/api/v1/invitations/accept", member.cookie, { token: new URL(mail.text).hash.slice(1) })).statusCode).toBe(200); members.push(member);
  }
  return members;
}
async function create(owner: Member) {
  const revision = (await api("GET", "/api/v1/workspaces/current", owner.cookie)).json<{ workspace: { revision: number } }>().workspace.revision;
  const made = await api("POST", "/api/v1/projects", owner.cookie, { commandId: randomUUID(), version: 1, workspaceId: WORKSPACE_ID, expectedRevision: revision, name: "Realtime", description: "private fixture", startDate: "2026-11-02" });
  expect(made.statusCode).toBe(200); return read(owner, made.json<{ projectId: string }>().projectId);
}
async function read(member: Member, id: string) { return snapshotSchema.parse((await api("GET", `/api/v1/projects/${id}`, member.cookie)).json<unknown>()); }
function envelope(d: Snapshot, command: ContentCommand) { return { commandId: randomUUID(), version: 1 as const, workspaceId: WORKSPACE_ID, projectId: d.project.id, expectedRevision: d.project.revision, command }; }
async function acquire(member: Member, e: ReturnType<typeof envelope>) {
  const response = await api("POST", `/api/v1/projects/${e.projectId}/leases`, member.cookie, e); expect(response.statusCode, response.body).toBe(200);
  const result = leasePreparedSchema.parse(response.json<unknown>()); if (!("lease" in result)) throw Error("Expected a new lease"); return result.lease;
}
function commit(member: Member, e: ReturnType<typeof envelope>, lease?: LeaseProof) {
  return api("POST", `/api/v1/projects/${e.projectId}/commands`, member.cookie, e, lease ? { "x-timeline-lease": lease.id, "x-timeline-fence": String(lease.fence) } : {});
}
async function cursor(member: Member) { return cursorSchema.parse((await api("GET", "/api/v1/realtime/cursor", member.cookie)).json<unknown>()).sequence; }
async function until(predicate: () => boolean | Promise<boolean>) {
  const end = Date.now() + 6000;
  while (Date.now() < end) { if (await predicate()) return; await new Promise((done) => { setTimeout(done, 25); }); }
  throw Error("Expected collaboration condition not observed");
}
async function stream(base: string, member: Pick<Member, "cookie">, after: number) {
  const control = new AbortController(); streams.add(control);
  // No global fetch pool: aborted SSE must not leave speculative test TCP sockets.
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpRequest(`${base}/api/v1/realtime/events?after=${String(after)}`, { headers: { cookie: member.cookie }, signal: control.signal, agent: false }, resolve);
    request.on("error", reject); request.end();
  });
  const frames: ReturnType<EventFrames["push"]> = [], parser = new EventFrames(), decoder = new TextDecoder();
  const done = (async () => {
    if (response.statusCode !== 200) { response.resume(); return; }
    try { for await (const raw of response) { const part: unknown = raw; if (!(part instanceof Uint8Array)) throw Error("Invalid stream chunk"); frames.push(...parser.push(decoder.decode(part, { stream: true }))); if (frames.length > 128) frames.splice(0, frames.length - 128); } }
    catch { /* Abort / killed fixture process. */ }
  })();
  return { status: response.statusCode, frames, done, close: () => { control.abort(); streams.delete(control); } };
}
async function childRuntime() {
  const socket = createServer(); await new Promise<void>((done) => { socket.listen(0, "127.0.0.1", done); });
  const bound = socket.address(); if (!bound || typeof bound === "string") throw Error("Fixture port missing");
  const port = bound.port; await new Promise<void>((done) => { socket.close(() => { done(); }); });
  const child = spawn(process.execPath, ["--import", "tsx", "server/main.ts"], { stdio: "ignore", env: { ...process.env, DATABASE_URL: runtimeUrl, BETTER_AUTH_SECRET: secret, APP_ORIGIN: origin, NODE_ENV: "test", MAILER_MODE: "memory", HOST: "127.0.0.1", PORT: String(port) } }); children.add(child);
  const base = `http://127.0.0.1:${String(port)}`;
  await until(async () => { try { return (await fetch(`${base}/health/ready`)).ok; } catch { return false; } });
  return { base, kill: () => new Promise<void>((done) => { if (child.exitCode !== null || child.signalCode) { children.delete(child); done(); return; } child.once("exit", () => { children.delete(child); done(); }); child.kill("SIGKILL"); }) };
}

describe("V2.1B real PostgreSQL collaboration", () => {
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL; if (!url || !new URL(url).pathname.endsWith("_test")) throw Error("Only isolated *_test allowed");
    admin = new Pool({ connectionString: url }); await migrateDatabase(admin);
    const pass = randomBytes(32).toString("base64url"); await admin.query(`create role ${escapeIdentifier(role)} login password ${escapeLiteral(pass)} nosuperuser nocreatedb nocreaterole nobypassrls`);
    await admin.query(`grant usage on schema public, drizzle to ${escapeIdentifier(role)}`); await admin.query(`grant select,insert,update,delete on all tables in schema public to ${escapeIdentifier(role)}`); await admin.query(`grant select on all tables in schema drizzle to ${escapeIdentifier(role)}`);
    const parsed = new URL(url); parsed.username = role; parsed.password = pass; runtimeUrl = parsed.toString();
  });
  beforeEach(async () => { await admin.query("truncate auth_users, auth_verifications, auth_rate_limits cascade"); requestNumber = 0; mailer = new MemoryMailer(); runtime = await createApp(config(runtimeUrl), mailer); });
  afterEach(async () => { for (const control of streams) control.abort(); streams.clear(); for (const child of children) child.kill("SIGKILL"); children.clear(); await runtime.app.close(); });
  afterAll(async () => { await admin.query(`drop owned by ${escapeIdentifier(role)}`); await admin.query(`drop role ${escapeIdentifier(role)}`); await admin.end(); });

  it("four editors: independent leases commit, competing task/cascade and legacy bypass are rejected, retry/no-op emit once", async () => {
    const members = await editors(4), owner = members[0], bob = members[1], carol = members[2]; if (!owner || !bob || !carol) throw Error("Fixture");
    const d = await create(owner), a = d.processes[0], b = d.processes[1]; if (!a || !b) throw Error("Fixture");
    const ea = envelope(d, { type: "Rename", kind: "process", id: a.id, value: "Alice" }), eb = envelope(d, { type: "Rename", kind: "process", id: b.id, value: "Bob" });
    const la = await acquire(owner, ea), lb = await acquire(bob, eb);
    expect((await admin.query("select id from edit_leases")).rowCount).toBe(2);
    const competing = envelope(d, { type: "Rename", kind: "task", id: d.tasks.find((t) => t.processId === a.id)?.id ?? "", value: "Competing" });
    expect((await api("POST", `/api/v1/projects/${d.project.id}/leases`, carol.cookie, competing)).json<unknown>()).toEqual({ error: "LEASE_BUSY" });
    expect((await commit(carol, competing)).statusCode).toBe(409);
    expect((await commit(carol, envelope(d, { type: "ShiftProject", days: 1 }))).statusCode).toBe(409);
    const accepted = await Promise.all([commit(owner, ea, la), commit(bob, eb, lb)]); expect(accepted.map((r) => r.statusCode)).toEqual([200, 200]);
    const after = await read(owner, d.project.id); expect(after.project.revision).toBe(2); expect(after.processes.map((p) => p.title)).toEqual(expect.arrayContaining(["Alice", "Bob"]));
    const sequence = await cursor(owner); const retry = await commit(owner, ea, la); expect(retry.statusCode).toBe(200); expect(retry.json<unknown>()).toEqual(accepted[0].json<unknown>()); expect(await cursor(owner)).toBe(sequence);
    expect((await api("POST", `/api/v1/projects/${d.project.id}/leases`, carol.cookie, competing)).json<unknown>()).toEqual({ error: "REVISION_CONFLICT" });
    const noop = await commit(owner, envelope(after, { type: "Rename", kind: "process", id: a.id, value: "Alice" })); expect(noop.json<{ changed: boolean }>().changed).toBe(false); expect(await cursor(owner)).toBe(sequence);
  });
  it("TTL, renewal, session ownership and fencing reject a stale holder after takeover; dependencies cannot silently change", async () => {
    const [owner, bob] = await editors(); if (!owner || !bob) throw Error("Fixture");
    const d = await create(owner), id = d.processes[0]?.id ?? "", e = envelope(d, { type: "Rename", kind: "process", id, value: "Old" });
    const old = await acquire(owner, e);
    expect((await api("POST", `/api/v1/projects/${d.project.id}/leases/${old.id}/renew`, bob.cookie, { commandId: e.commandId, fence: old.fence })).statusCode).toBe(403);
    expect((await commit(bob, e, old)).statusCode).toBe(403);
    const anotherLogin = await api("POST", "/api/auth/sign-in/email", "", { email: owner.email, password });
    const anotherCookies = anotherLogin.headers["set-cookie"], anotherSession = (Array.isArray(anotherCookies) ? anotherCookies : [anotherCookies ?? ""]).map((value) => value.split(";")[0]).join("; ");
    expect((await api("POST", `/api/v1/projects/${d.project.id}/leases/${old.id}/renew`, anotherSession, { commandId: e.commandId, fence: old.fence })).statusCode).toBe(403);
    await admin.query("update edit_leases set expires_at=clock_timestamp()+interval '1 second' where id=$1", [old.id]);
    const renewed = await api("POST", `/api/v1/projects/${d.project.id}/leases/${old.id}/renew`, owner.cookie, { commandId: e.commandId, fence: old.fence }); expect(renewed.statusCode).toBe(200);
    expect(new Date(renewed.json<{ lease: { expiresAt: string } }>().lease.expiresAt).getTime() - Date.now()).toBeGreaterThan(15_000);
    await admin.query("update edit_leases set expires_at=clock_timestamp()-interval '1 second' where id=$1", [old.id]);
    const next = envelope(d, { type: "Rename", kind: "process", id, value: "New" }), held = await acquire(bob, next); expect(held.fence).toBeGreaterThan(old.fence);
    expect((await commit(owner, e, old)).json<unknown>()).toEqual({ error: "LEASE_STALE" }); expect((await read(owner, d.project.id)).project.revision).toBe(0);
    const person = { commandId: randomUUID(), workspaceId: WORKSPACE_ID, expectedRevision: 0, command: { type: "CreatePerson", id: randomUUID(), fields: { firstName: "Private fixture", lastName: "", defaultRole: "", contacts: "private-contact", note: "private-note" } } };
    expect((await api("POST", "/api/v1/people/commands", owner.cookie, person)).statusCode).toBe(200);
    expect((await commit(bob, next, held)).json<unknown>()).toEqual({ error: "REVISION_CONFLICT" }); expect((await read(owner, d.project.id)).project.revision).toBe(0);
  });
  it("a cascade race cannot expand a previously independent write set or overwrite the first mover", async () => {
    const [owner, bob] = await editors(); if (!owner || !bob) throw Error("Fixture");
    const d = await create(owner), a = d.processes[0], b = d.processes.find((p) => p.stageId === a?.stageId && p.id !== a.id); if (!a || !b) throw Error("Fixture");
    // Valid restored fixture: two short, empty processes share a lane with one free day.
    await admin.query("delete from tasks where process_id=any($1::uuid[])", [[a.id, b.id]]);
    await admin.query("update processes set start_date=$1,end_date_exclusive=$2 where id=$3", [a.startDate, addDays(a.startDate, 2), a.id]);
    await admin.query("update processes set start_date=$1,end_date_exclusive=$2,lane_id=$3 where id=$4", [addDays(a.startDate, 3), addDays(a.startDate, 5), a.laneId, b.id]);
    const initial = await read(owner, d.project.id), ea = envelope(initial, { type: "GroupMove", kind: "process", ids: [a.id], days: 1 }), eb = envelope(initial, { type: "GroupMove", kind: "process", ids: [b.id], days: -1 });
    const la = await acquire(owner, ea), lb = await acquire(bob, eb);
    expect((await commit(owner, ea, la)).statusCode).toBe(200);
    // Moving B left now requires cascading A: its original lease covers only B.
    const raced = await commit(bob, eb, lb); expect(raced.statusCode, raced.body).toBe(409);
    expect(raced.json<unknown>()).toEqual({ error: "REVISION_CONFLICT" });
    const after = await read(owner, d.project.id); expect(after.project.revision).toBe(1);
    expect(after.processes.find((p) => p.id === a.id)?.startDate).toBe(addDays(a.startDate, 1));
    expect(after.processes.find((p) => p.id === b.id)?.startDate).toBe(addDays(a.startDate, 3));
    expect((await admin.query("select command_id from command_receipts where command_id=$1", [eb.commandId])).rowCount).toBe(0);
  });
  it("two Node processes: SIGKILL loses no committed event/lease; replay after restart is durable and revoked streams close", async () => {
    const [owner, bob] = await editors(); if (!owner || !bob) throw Error("Fixture");
    const d = await create(owner), start = await cursor(owner), child = await childRuntime(), viewing = await stream(child.base, bob, start);
    await until(() => viewing.frames.some((f) => f.event === "ready"));
    const e = envelope(d, { type: "Rename", kind: "process", id: d.processes[0]?.id ?? "", value: "Durable" }); const held = await acquire(owner, e);
    await child.kill(); await viewing.done;
    expect((await commit(owner, e, held)).statusCode).toBe(200);
    const again = await childRuntime(), replay = await stream(again.base, bob, start);
    await until(() => replay.frames.some((f) => f.event === "change"));
    const event = changeSchema.parse(replay.frames.find((f) => f.event === "change")?.data); expect(event.commandId).toBe(e.commandId); expect(event.sequence).toBe(start + 1);
    expect(JSON.stringify(replay.frames)).not.toMatch(/contacts|private-contact|email|token|history|resources|basis/);
    const response = await fetch(`${again.base}/api/v1/projects/${d.project.id}/commands`, { method: "POST", headers: { cookie: owner.cookie, origin, "Content-Type": "application/json", "X-Timeline-Lease": held.id, "X-Timeline-Fence": String(held.fence) }, body: JSON.stringify(e) }); expect(response.status).toBe(200); await response.body?.cancel(); expect(await cursor(owner)).toBe(start + 1);
    expect((await api("DELETE", `/api/v1/members/${bob.id}`, owner.cookie)).statusCode).toBe(200);
    await until(() => replay.frames.some((f) => f.event === "access-denied")); await replay.done;
    await again.kill();
  }, 30_000);
  it("SSE excludes outsiders/guests, respects logout, limits connections and reports gaps without leaking private write sets", async () => {
    const [owner] = await editors(1); if (!owner) throw Error("Fixture"); const d = await create(owner), outside = await register("outsider-collaboration@example.test");
    const base = await runtime.app.listen({ host: "127.0.0.1", port: 0 }), head = await cursor(owner);
    expect((await stream(base, outside, 0)).status).toBe(403); expect((await stream(base, { cookie: "" }, 0)).status).toBe(401);
    const issued = (await api("POST", `/api/v1/projects/${d.project.id}/guest-links`, owner.cookie)).json<{ url: string }>();
    const exchange = await api("POST", "/api/v1/guest/exchange", "", { token: new URL(issued.url).hash.slice(1) }); const guestCookie = String(exchange.headers["set-cookie"]).split(";")[0] ?? "";
    expect((await api("GET", "/api/v1/guest/project", guestCookie)).statusCode).toBe(200); expect((await stream(base, { cookie: guestCookie }, 0)).status).toBe(401);
    const connected = await Promise.all([stream(base, owner, head), stream(base, owner, head), stream(base, owner, head)]);
    expect((await stream(base, owner, head)).status).toBe(429); connected[0].close(); await connected[0].done;
    await new Promise((done) => { setTimeout(done, 50); }); const replacement = await stream(base, owner, head); expect(replacement.status).toBe(200);
    for (const s of connected) s.close(); replacement.close();
    await api("POST", "/api/v1/projects", owner.cookie, { commandId: randomUUID(), version: 1, workspaceId: WORKSPACE_ID, expectedRevision: 1, name: "Gap", description: "", startDate: "2026-11-02" });
    await admin.query("delete from workspace_events where sequence=$1", [head]);
    const gap = await stream(base, owner, 0); await until(() => gap.frames.some((f) => f.event === "reset")); await gap.done;
    const live = await stream(base, owner, await cursor(owner)); await until(() => live.frames.some((f) => f.event === "ready"));
    expect((await api("POST", "/api/auth/sign-out", owner.cookie, {})).statusCode).toBe(200); await until(() => live.frames.some((f) => f.event === "access-denied")); await live.done;
    const login = await api("POST", "/api/auth/sign-in/email", "", { email: owner.email, password }), cookies = login.headers["set-cookie"];
    const renewedCookie = (Array.isArray(cookies) ? cookies : [cookies ?? ""]).map((value) => value.split(";")[0]).join("; ");
    const renewedMember = { ...owner, cookie: renewedCookie }, expiring = await stream(base, renewedMember, await cursor(renewedMember));
    await until(() => expiring.frames.some((f) => f.event === "ready"));
    await admin.query("update auth_sessions set expires_at=clock_timestamp()-interval '1 second' where user_id=$1", [owner.id]);
    await until(() => expiring.frames.some((f) => f.event === "access-denied")); await expiring.done;
    expect((await api("POST", `/api/v1/projects/${d.project.id}/leases`, renewedCookie, envelope(d, { type: "ShiftProject", days: 1 }))).statusCode).toBe(401);
  }, 25_000);
  it("bounds retained outbox history and makes a pruned cursor request a snapshot reset", async () => {
    const [owner] = await editors(1); if (!owner) throw Error("Fixture"); const d = await create(owner);
    await admin.query("delete from workspace_events"); await admin.query("update collaboration_state set sequence=$1", [EVENT_RETENTION]);
    await admin.query("insert into workspace_events(workspace_id,sequence,project_id,revision,workspace_revision,people_revision,resources) select $1,n,$2,0,1,0,'[]'::jsonb from generate_series(1,$3) n", [WORKSPACE_ID, d.project.id, EVENT_RETENTION]);
    expect((await commit(owner, envelope(d, { type: "Rename", kind: "project", id: d.project.id, value: "Bounded" }))).statusCode).toBe(200);
    expect((await admin.query<{ count: string }>("select count(*) from workspace_events")).rows[0]?.count).toBe(String(EVENT_RETENTION));
    const base = await runtime.app.listen({ host: "127.0.0.1", port: 0 }), old = await stream(base, owner, 0);
    await until(() => old.frames.some((f) => f.event === "reset")); await old.done;
  });
});
