import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { ServerResponse } from "node:http";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { WORKSPACE_ID } from "../src/domain/v2/model";
import { changeSchema, counterSchema } from "../src/application/v2/collaborationContracts";
import type { Database } from "./db/connection";
import * as t from "./db/schema";
import { lockAccess } from "./access";
import type { Actor } from "./access";
import { ApiError } from "./errors";
import { EVENT_RETENTION } from "./outbox";

const querySchema = z.strictObject({ after: z.coerce.number().pipe(counterSchema).default(0) });
/** Bounded HTTP connections, PostgreSQL is the authority. No process-local event/lock bus. */
export function registerRealtime(app: FastifyInstance, db: Database, actor: (r: FastifyRequest) => Promise<Actor>) {
  const active = new Map<ServerResponse, () => void>(), perUser = new Map<string, number>();
  let stopping = false;
  app.addHook("preClose", (done) => { stopping = true; for (const close of [...active.values()]) close(); done(); });
  app.get("/api/v1/realtime/cursor", async (request) => {
    const a = await actor(request);
    return db.transaction(async (tx) => {
      await lockAccess(tx, a, WORKSPACE_ID);
      const [state] = await tx.select().from(t.collaborationState).where(eq(t.collaborationState.workspaceId, WORKSPACE_ID));
      return { workspaceId: WORKSPACE_ID, userId: a.id, sequence: state?.sequence ?? 0 };
    });
  });
  app.get("/api/v1/realtime/events", async (request, reply) => {
    const first = await actor(request), query = querySchema.parse(request.query);
    await db.transaction((tx) => lockAccess(tx, first, WORKSPACE_ID));
    if (stopping) throw new ApiError(503, "UNAVAILABLE");
    if (active.size >= 12 || (perUser.get(first.id) ?? 0) >= 3) throw new ApiError(429, "STREAM_LIMIT");
    let closed = false, timer: ReturnType<typeof setTimeout> | undefined, wake: (() => void) | undefined;
    const isClosed = () => closed;
    const response = reply.raw;
    const close = () => {
      if (closed) return; closed = true;
      clearTimeout(timer); wake?.();
      active.delete(response);
      const count = (perUser.get(first.id) ?? 1) - 1;
      if (count) perUser.set(first.id, count); else perUser.delete(first.id);
      response.off("close", close); response.off("error", close);
      if (!response.destroyed) response.end();
    };
    active.set(response, close); perUser.set(first.id, (perUser.get(first.id) ?? 0) + 1);
    response.once("close", close); response.once("error", close);
    reply.hijack();
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "Content-Encoding": "identity", Connection: "close",
      "X-Accel-Buffering": "no", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Timeline-User": first.id });
    const write = (event: string, data: unknown, id?: number) => {
      if (closed) return;
      if (!response.write(`${id === undefined ? "" : `id: ${String(id)}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) close();
    };
    let after = query.after, ready = false;
    try {
      while (!isClosed()) {
        const current = await actor(request);
        if (current.id !== first.id || current.sessionId !== first.sessionId) throw new ApiError(401, "VERIFIED_SESSION_REQUIRED");
        const batch = await db.transaction(async (tx) => {
          await lockAccess(tx, current, WORKSPACE_ID);
          const [state] = await tx.select().from(t.collaborationState).where(eq(t.collaborationState.workspaceId, WORKSPACE_ID));
          const head = state?.sequence ?? 0;
          // Explicit select prevents private write sets and all content/auth DTOs entering SSE.
          const events = await tx.select({ sequence: t.workspaceEvents.sequence, workspaceId: t.workspaceEvents.workspaceId, projectId: t.workspaceEvents.projectId,
            commandId: t.workspaceEvents.commandId, revision: t.workspaceEvents.revision, workspaceRevision: t.workspaceEvents.workspaceRevision, peopleRevision: t.workspaceEvents.peopleRevision })
            .from(t.workspaceEvents).where(and(eq(t.workspaceEvents.workspaceId, WORKSPACE_ID), gt(t.workspaceEvents.sequence, after))).orderBy(t.workspaceEvents.sequence).limit(64);
          return { head, events };
        });
        if (isClosed()) break;
        if (after > batch.head || after < batch.head - EVENT_RETENTION || batch.events.some((e, i) => e.sequence !== after + i + 1)) {
          write("reset", { sequence: batch.head }); break;
        }
        for (const event of batch.events) { write("change", changeSchema.parse(event), event.sequence); after = event.sequence; }
        if (!ready && after >= batch.head) { ready = true; write("ready", { sequence: after }); }
        if (!isClosed() && !response.write(": heartbeat\n\n")) close();
        if (!isClosed()) await new Promise<void>((resolve) => { wake = resolve; timer = setTimeout(resolve, batch.events.length === 64 ? 10 : 1000); });
      }
    } catch (e) {
      if (e instanceof ApiError && (e.statusCode === 401 || e.statusCode === 403)) write("access-denied", { status: e.statusCode });
      else write("unavailable", {});
    } finally { close(); }
  });
}
