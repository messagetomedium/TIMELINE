import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { WORKSPACE_ID } from "../src/domain/v2/model";
import type { Database, QueryDatabase } from "./db/connection";
import * as t from "./db/schema";
import type { Actor } from "./access";
import { activeMember, lockAccess } from "./access";
import { hashPayload } from "./commands";
import type { Config } from "./config";
import type { Mailer } from "./mailer";
import { ApiError } from "./errors";

export const opaqueToken = () => randomBytes(32).toString("base64url");
// Purpose is included so an invite can never be exchanged as a guest credential.
export const tokenHash = (purpose: "invite" | "guest-link" | "guest-session", token: string) => hashPayload({ purpose, token });

async function editorLimit(db: QueryDatabase, workspace: typeof t.workspaces.$inferSelect) {
  const [{ value } = { value: 0 }] = await db.select({ value: sql<number>`count(*)::int` }).from(t.memberships).where(and(eq(t.memberships.workspaceId, workspace.id), isNull(t.memberships.revokedAt)));
  if (value >= workspace.maxEditors) throw new ApiError(409, "EDITOR_LIMIT");
}
export class Members {
  constructor(readonly db: Database, readonly config: Config, readonly mailer: Mailer) {}

  async invite(actor: Actor, email: string) {
    const token = opaqueToken(), id = randomUUID(), expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await this.db.transaction(async (db) => {
      const { workspace } = await lockAccess(db, actor, WORKSPACE_ID);
      await editorLimit(db, workspace);
      await db.insert(t.invitations).values({ id, workspaceId: workspace.id, creatorId: actor.id, email, tokenHash: tokenHash("invite", token), expiresAt });
    });
    try {
      // A fragment keeps the secret out of HTTP access logs and referrers.
      await this.mailer.send({ to: email, subject: "TIMELINE: приглашение администратора", text: `${this.config.APP_ORIGIN}/invite#${token}` });
    } catch {
      await this.db.update(t.invitations).set({ revokedAt: new Date() }).where(eq(t.invitations.id, id));
      throw new ApiError(503, "MAIL_UNAVAILABLE");
    }
    return { id, expiresAt: expiresAt.toISOString() };
  }

  async accept(actor: Actor, token: string) {
    return this.db.transaction(async (db) => {
      const [workspace] = await db.select().from(t.workspaces).where(eq(t.workspaces.id, WORKSPACE_ID)).for("update");
      if (!workspace) throw new ApiError(403, "INVITATION_INVALID");
      const [user] = await db.select().from(t.user).where(eq(t.user.id, actor.id));
      if (!user?.emailVerified) throw new ApiError(401, "VERIFIED_SESSION_REQUIRED");
      const [invite] = await db.select().from(t.invitations).where(and(eq(t.invitations.workspaceId, workspace.id), eq(t.invitations.tokenHash, tokenHash("invite", token)))).for("update");
      if (!invite || invite.email !== user.email.toLowerCase() || invite.revokedAt || invite.usedCount >= invite.maxUses || invite.expiresAt <= new Date()) throw new ApiError(403, "INVITATION_INVALID");
      await activeMember(db, workspace.id, invite.creatorId);
      const [member] = await db.select().from(t.memberships).where(and(eq(t.memberships.workspaceId, workspace.id), eq(t.memberships.userId, actor.id)));
      if (!member || member.revokedAt) {
        await editorLimit(db, workspace);
        await db.insert(t.memberships).values({ workspaceId: workspace.id, userId: actor.id, role: "admin" }).onConflictDoUpdate({ target: [t.memberships.workspaceId, t.memberships.userId], set: { role: "admin", revokedAt: null, revision: sql`${t.memberships.revision} + 1` } });
      }
      await db.update(t.invitations).set({ usedCount: invite.usedCount + 1 }).where(eq(t.invitations.id, invite.id));
      await db.update(t.workspaces).set({ revision: workspace.revision + 1 }).where(eq(t.workspaces.id, workspace.id));
      return { workspaceId: workspace.id, role: member?.role === "owner" ? "owner" : "admin" };
    });
  }

  async revokeInvite(actor: Actor, id: string) {
    await this.db.transaction(async (db) => {
      const { workspace } = await lockAccess(db, actor, WORKSPACE_ID);
      const rows = await db.update(t.invitations).set({ revokedAt: new Date() }).where(and(eq(t.invitations.workspaceId, workspace.id), eq(t.invitations.id, id))).returning({ id: t.invitations.id });
      if (!rows.length) throw new ApiError(404, "NOT_FOUND");
    });
  }

  async revokeMember(actor: Actor, userId: string) {
    await this.db.transaction(async (db) => {
      const { workspace, member } = await lockAccess(db, actor, WORKSPACE_ID);
      if (member.role !== "owner" || userId === workspace.ownerUserId) throw new ApiError(403, "OWNER_REQUIRED");
      const rows = await db.update(t.memberships).set({ revokedAt: new Date(), revision: sql`${t.memberships.revision} + 1` }).where(and(eq(t.memberships.workspaceId, workspace.id), eq(t.memberships.userId, userId))).returning({ id: t.memberships.userId });
      if (!rows.length) throw new ApiError(404, "NOT_FOUND");
      await db.update(t.invitations).set({ revokedAt: new Date() }).where(and(eq(t.invitations.workspaceId, workspace.id), eq(t.invitations.creatorId, userId)));
      await db.update(t.guestLinks).set({ revokedAt: new Date() }).where(and(eq(t.guestLinks.workspaceId, workspace.id), eq(t.guestLinks.creatorId, userId)));
      await db.update(t.workspaces).set({ revision: workspace.revision + 1 }).where(eq(t.workspaces.id, workspace.id));
    });
  }
}

export async function guestCapacity(db: QueryDatabase, workspace: typeof t.workspaces.$inferSelect) {
  // Ignore sessions of revoked links and revoked creators, even before expiry.
  const [{ value } = { value: 0 }] = await db.select({ value: sql<number>`count(*)::int` }).from(t.guestSessions)
    .innerJoin(t.guestLinks, and(eq(t.guestLinks.id, t.guestSessions.linkId), eq(t.guestLinks.workspaceId, t.guestSessions.workspaceId)))
    .innerJoin(t.memberships, and(eq(t.memberships.workspaceId, t.guestLinks.workspaceId), eq(t.memberships.userId, t.guestLinks.creatorId)))
    .where(and(eq(t.guestSessions.workspaceId, workspace.id), gt(t.guestSessions.expiresAt, new Date()), isNull(t.guestLinks.revokedAt), isNull(t.memberships.revokedAt)));
  if (value >= workspace.maxGuests) throw new ApiError(429, "GUEST_LIMIT");
}
