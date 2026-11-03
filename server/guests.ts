import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database, QueryDatabase } from "./db/connection";
import * as t from "./db/schema";
import { activeMember, lockAccess, lockProject } from "./access";
import type { Actor } from "./access";
import { opaqueToken, tokenHash, guestCapacity } from "./members";
import { guestProjectSchema } from "./dto";
import { PostgresRepository } from "./db/repository";
import { checkpointDate } from "../src/domain/v2/model";
import { ApiError, requireValue } from "./errors";

export class Guests {
  constructor(readonly db: Database) {}
  async issue(actor: Actor, workspaceId: string, projectId: string) {
    const token = opaqueToken(), id = randomUUID();
    await this.db.transaction(async (db) => {
      await lockAccess(db, actor, workspaceId);
      const project = await lockProject(db, workspaceId, projectId);
      if (project.archivedAt) throw new ApiError(404, "NOT_FOUND");
      await db.insert(t.guestLinks).values({ id, workspaceId, projectId, creatorId: actor.id, tokenHash: tokenHash("guest-link", token) });
    });
    return { id, token };
  }
  async revoke(actor: Actor, workspaceId: string, id: string) {
    await this.db.transaction(async (db) => {
      await lockAccess(db, actor, workspaceId);
      const rows = await db.update(t.guestLinks).set({ revokedAt: new Date() }).where(and(eq(t.guestLinks.workspaceId, workspaceId), eq(t.guestLinks.id, id))).returning({ id: t.guestLinks.id });
      if (!rows.length) throw new ApiError(404, "NOT_FOUND");
    });
  }
  private async validLink(db: QueryDatabase, id: string, workspaceId: string) {
    const [link] = await db.select().from(t.guestLinks).where(and(eq(t.guestLinks.workspaceId, workspaceId), eq(t.guestLinks.id, id)));
    if (!link || link.revokedAt || link.permissions !== "read") throw new ApiError(403, "GUEST_ACCESS_DENIED");
    await activeMember(db, workspaceId, link.creatorId);
    const project = await lockProject(db, workspaceId, link.projectId);
    if (project.archivedAt || project.visibility !== "workspace") throw new ApiError(403, "GUEST_ACCESS_DENIED");
    return link;
  }
  async exchange(token: string) {
    return this.db.transaction(async (db) => {
      const [candidate] = await db.select().from(t.guestLinks).where(eq(t.guestLinks.tokenHash, tokenHash("guest-link", token)));
      if (!candidate) throw new ApiError(403, "GUEST_ACCESS_DENIED");
      const workspace = requireValue((await db.select().from(t.workspaces).where(eq(t.workspaces.id, candidate.workspaceId)).for("update"))[0]);
      const link = await this.validLink(db, candidate.id, workspace.id);
      await guestCapacity(db, workspace);
      const sessionToken = opaqueToken(), expiresAt = new Date(Date.now() + 60 * 60_000);
      await db.insert(t.guestSessions).values({ id: randomUUID(), workspaceId: workspace.id, linkId: link.id, tokenHash: tokenHash("guest-session", sessionToken), expiresAt });
      return { token: sessionToken, expiresAt };
    });
  }
  async read(token: string) {
    return this.db.transaction(async (db) => {
      const [session] = await db.select().from(t.guestSessions).where(eq(t.guestSessions.tokenHash, tokenHash("guest-session", token)));
      if (!session || session.expiresAt <= new Date()) throw new ApiError(401, "GUEST_SESSION_REQUIRED");
      await db.select().from(t.workspaces).where(eq(t.workspaces.id, session.workspaceId)).for("update");
      const link = await this.validLink(db, session.linkId, session.workspaceId);
      const d = requireValue(await new PostgresRepository(db, session.workspaceId, link.creatorId).load(link.projectId));
      return guestProjectSchema.parse({
        project: { id: d.project.id, name: d.project.name, startDate: d.project.startDate, endDateExclusive: d.project.endDateExclusive, revision: d.project.revision },
        stages: d.stages.map(({ id, title, startDate, endDateExclusive, sortIndex }) => ({ id, title, startDate, endDateExclusive, sortIndex })),
        processes: d.processes.map(({ id, stageId, isActive, title, startDate, endDateExclusive, status, color }) => ({ id, stageId, isActive, title, startDate, endDateExclusive, status, color })),
        tasks: d.tasks.map(({ id, processId, isActive, title, startDate, endDateExclusive, status }) => ({ id, processId, isActive, title, startDate, endDateExclusive, status })),
        results: d.results.map(({ id, stageId, processId, title }) => ({ id, stageId, processId, title })),
        checkpoints: d.checkpoints.map((c) => ({ id: c.id, title: c.title, date: checkpointDate(d, c) })),
      });
    });
  }
}
