import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import { WORKSPACE_ID } from "../src/domain/v2/model";
import { envelopeSchema } from "../src/domain/v2/commands";
import { normalizeView } from "../src/domain/v2/model";
import * as t from "./db/schema";
import { connect } from "./db/connection";
import { assertMigrations } from "./db/migrate";
import { PostgresRepository } from "./db/repository";
import { createAuth } from "./auth";
import type { Config } from "./config";
import { createMailer } from "./mailer";
import type { Mailer } from "./mailer";
import { lockAccess } from "./access";
import type { Actor } from "./access";
import { ServerCommands } from "./commands";
import { Members } from "./members";
import { Guests } from "./guests";
import { ApiError, requireValue } from "./errors";
import { boundedInput, createProjectSchema, idParams, inviteSchema, peopleEnvelopeSchema, tokenSchema, viewSchema, workspaceCommandSchema } from "./dto";
import type { FastifyRequest } from "fastify";
import { registerFrontend } from "./frontend";

const querySchema = z.strictObject({ workspaceId: z.uuid().default(WORKSPACE_ID) });
const listSchema = querySchema.extend({ limit: z.coerce.number().int().min(1).max(100).default(40), offset: z.coerce.number().int().min(0).max(1_000_000).default(0) });
const guestCookieName = "timeline_guest";

export async function createApp(config: Config, suppliedMailer?: Mailer) {
  const { db, pool } = connect(config.DATABASE_URL, config);
  const mailer = suppliedMailer ?? createMailer(config);
  try {
    await assertMigrations(pool);
    const { rows } = await pool.query<{ unsafe: boolean }>("select rolsuper or rolcreatedb or rolcreaterole or rolbypassrls or has_schema_privilege(current_user, 'public', 'CREATE') as unsafe from pg_roles where rolname = current_user");
    if (rows[0]?.unsafe !== false) throw Error("Runtime DATABASE_URL must use a restricted application role");
  } catch (error) {
    await pool.end();
    mailer.close();
    throw error;
  }
  // Automatic URL/body logging would expose verification and reset tokens.
  const app = Fastify({ logger: false, trustProxy: config.TRUST_PROXY.length ? config.TRUST_PROXY : false, bodyLimit: 256 * 1024, requestTimeout: 15_000, routerOptions: { maxParamLength: 128 } });
  const auth = createAuth(db, config, mailer), commands = new ServerCommands(db), members = new Members(db, config, mailer), guests = new Guests(db);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  app.addHook("onClose", async () => { mailer.close(); await pool.end(); });
  app.addHook("onRequest", (request, reply, done) => {
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && (request.headers.origin !== config.APP_ORIGIN || request.headers["sec-fetch-site"] === "cross-site")) {
      done(new ApiError(403, "ORIGIN_REJECTED"));
      return;
    }
    done();
  });
  app.addHook("preValidation", (request, _reply, done) => {
    try { boundedInput(request.body); done(); } catch { done(new ApiError(400, "INPUT_LIMIT")); }
  });
  app.setErrorHandler((error, _request, reply) => {
    const cause: unknown = error;
    if (cause instanceof ApiError) { void reply.code(cause.statusCode).send({ error: cause.code }); return; }
    if (cause instanceof z.ZodError) { void reply.code(400).send({ error: "VALIDATION_ERROR" }); return; }
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
    const nested = cause && typeof cause === "object" && "cause" in cause ? cause.cause : undefined;
    const pgCode = nested && typeof nested === "object" && "code" in nested ? nested.code : code;
    const status = cause && typeof cause === "object" && "statusCode" in cause ? cause.statusCode : undefined;
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") { void reply.code(413).send({ error: "BODY_TOO_LARGE" }); return; }
    if (status === 429) { void reply.code(429).send({ error: "RATE_LIMITED" }); return; }
    if (status === 400 || status === 415) { void reply.code(status).send({ error: "INVALID_REQUEST" }); return; }
    if (["23505", "40001", "40P01"].includes(String(pgCode))) { void reply.code(409).send({ error: "CONFLICT" }); return; }
    if (["23503", "23514", "22P02", "22007", "22008"].includes(String(pgCode))) { void reply.code(422).send({ error: "CONSTRAINT_REJECTED" }); return; }
    if (["ECONNREFUSED", "57P01", "08006", "53300"].includes(String(pgCode))) { void reply.code(503).send({ error: "UNAVAILABLE" }); return; }
    void reply.code(500).send({ error: "INTERNAL_ERROR" });
  });

  function authHeaders(request: FastifyRequest) {
    const headers = fromNodeHeaders(request.headers);
    // Better Auth receives only the address resolved by Fastify, never a client proxy header.
    headers.set("x-timeline-client-ip", request.ip);
    return headers;
  }
  async function actor(request: FastifyRequest): Promise<Actor> {
    const value = await auth.api.getSession({ headers: authHeaders(request) });
    if (!value?.user.emailVerified) throw new ApiError(401, "VERIFIED_SESSION_REQUIRED");
    return { id: value.user.id, email: value.user.email };
  }
  app.get("/health/live", () => ({ status: "live" }));
  app.get("/health/ready", async (_request, reply) => {
    try { await pool.query("select 1"); await assertMigrations(pool); return { status: "ready" }; }
    catch { return reply.code(503).send({ status: "unavailable" }); }
  });
  app.route({ method: ["GET", "POST"], url: "/api/auth/*", config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, handler: async (request, reply) => {
    const response = await auth.handler(new Request(new URL(request.url, config.APP_ORIGIN), {
      method: request.method, headers: authHeaders(request), ...(request.method === "GET" ? {} : { body: JSON.stringify(request.body ?? {}) }),
    }));
    reply.code(response.status);
    response.headers.forEach((value, key) => { if (key.toLowerCase() !== "set-cookie") reply.header(key, value); });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header("set-cookie", cookies);
    return reply.send(await response.text());
  } });
  app.get("/api/v1/workspaces/current", async (request) => {
    const a = await actor(request);
    return db.transaction(async (tx) => {
      const { workspace, member } = await lockAccess(tx, a, WORKSPACE_ID);
      return { workspace: { id: workspace.id, name: workspace.name, revision: workspace.revision, peopleRevision: workspace.peopleRevision, limits: { projects: workspace.maxProjects, processes: workspace.maxProcesses, tasks: workspace.maxTasks, people: workspace.maxPeople, editors: workspace.maxEditors, guests: workspace.maxGuests } }, role: member.role };
    });
  });
  app.get("/api/v1/projects", async (request) => {
    const a = await actor(request), q = listSchema.parse(request.query);
    return db.transaction(async (tx) => {
      const { workspace } = await lockAccess(tx, a, q.workspaceId);
      const projects = await new PostgresRepository(tx, q.workspaceId, a.id).summaries(q.limit, q.offset);
      return { projects, workspaceRevision: workspace.revision, nextOffset: projects.length === q.limit ? q.offset + projects.length : null };
    });
  });
  app.post("/api/v1/projects", async (request) => commands.create(await actor(request), createProjectSchema.parse(request.body)));
  app.get("/api/v1/projects/:id", async (request) => {
    const a = await actor(request), { id } = idParams.parse(request.params), { workspaceId } = querySchema.parse(request.query);
    return db.transaction(async (tx) => {
      await lockAccess(tx, a, workspaceId);
      return requireValue(await new PostgresRepository(tx, workspaceId, a.id).load(id));
    });
  });
  app.post("/api/v1/projects/:id/commands", async (request) => {
    const a = await actor(request), { id } = idParams.parse(request.params), e = envelopeSchema.parse(request.body);
    if (id !== e.projectId) throw new ApiError(400, "PROJECT_SCOPE_MISMATCH");
    return commands.project(a, e);
  });
  app.get("/api/v1/people", async (request) => {
    const a = await actor(request), { workspaceId } = querySchema.parse(request.query);
    return db.transaction(async (tx) => {
      await lockAccess(tx, a, workspaceId);
      const { workspaceId: id, revision, people, retiredAssignments } = await new PostgresRepository(tx, workspaceId, a.id).loadCatalog();
      return { workspaceId: id, revision, people, retiredAssignments };
    });
  });
  app.post("/api/v1/people/commands", async (request) => commands.people(await actor(request), peopleEnvelopeSchema.parse(request.body)));
  app.post("/api/v1/workspace/commands", async (request) => commands.workspace(await actor(request), workspaceCommandSchema.parse(request.body)));
  app.put("/api/v1/projects/:id/view", async (request) => {
    const a = await actor(request), { id } = idParams.parse(request.params), e = viewSchema.parse(request.body);
    if (id !== e.value.projectId) throw new ApiError(400, "PROJECT_SCOPE_MISMATCH");
    return db.transaction(async (tx) => {
      await lockAccess(tx, a, e.workspaceId);
      const doc = requireValue(await new PostgresRepository(tx, e.workspaceId, a.id).load(id));
      const value = normalizeView(doc, e.value);
      await tx.insert(t.viewPreferences).values({ workspaceId: e.workspaceId, userId: a.id, scope: `project:${id}`, value }).onConflictDoUpdate({ target: [t.viewPreferences.workspaceId, t.viewPreferences.userId, t.viewPreferences.scope], set: { value } });
      return { value };
    });
  });
  const sensitive = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };
  app.post("/api/v1/invitations", sensitive, async (request) => members.invite(await actor(request), inviteSchema.parse(request.body).email));
  app.post("/api/v1/invitations/accept", sensitive, async (request) => members.accept(await actor(request), tokenSchema.parse(request.body).token));
  app.delete("/api/v1/invitations/:id", sensitive, async (request) => { await members.revokeInvite(await actor(request), idParams.parse(request.params).id); return { revoked: true }; });
  app.delete("/api/v1/members/:id", sensitive, async (request) => { await members.revokeMember(await actor(request), idParams.parse(request.params).id); return { revoked: true }; });
  app.post("/api/v1/projects/:id/guest-links", sensitive, async (request) => {
    const a = await actor(request), { id } = idParams.parse(request.params), { workspaceId } = querySchema.parse(request.query);
    const issued = await guests.issue(a, workspaceId, id);
    return { id: issued.id, url: `${config.APP_ORIGIN}/guest#${issued.token}` };
  });
  app.delete("/api/v1/guest-links/:id", sensitive, async (request) => {
    const a = await actor(request), { id } = idParams.parse(request.params), { workspaceId } = querySchema.parse(request.query);
    await guests.revoke(a, workspaceId, id); return { revoked: true };
  });
  app.post("/api/v1/guest/exchange", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const session = await guests.exchange(tokenSchema.parse(request.body).token);
    reply.header("set-cookie", `${guestCookieName}=${session.token}; Path=/api/v1/guest; HttpOnly; SameSite=Lax; Max-Age=3600${config.APP_ORIGIN.startsWith("https://") ? "; Secure" : ""}`);
    return { expiresAt: session.expiresAt.toISOString() };
  });
  app.get("/api/v1/guest/project", async (request) => {
    const cookie = request.headers.cookie?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${guestCookieName}=`))?.slice(guestCookieName.length + 1);
    if (!cookie || !/^[\w-]{43}$/.test(cookie)) throw new ApiError(401, "GUEST_SESSION_REQUIRED");
    return guests.read(cookie);
  });
  // Explicit no-data 404; unknown API paths never fall through to a SPA.
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: "NOT_FOUND" }));
  try { if (config.STATIC_ROOT) await registerFrontend(app, config.STATIC_ROOT, config.APP_STORAGE_MODE); }
  catch (error) { await app.close(); throw error; }
  return { app, auth, db, pool, mailer };
}
