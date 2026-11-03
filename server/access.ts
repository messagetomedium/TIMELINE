import { and, eq, isNull } from "drizzle-orm";
import { WORKSPACE_ID } from "../src/domain/v2/model";
import { ApiError, requireValue } from "./errors";
import type { QueryDatabase } from "./db/connection";
import * as t from "./db/schema";

export interface Actor { id: string; email: string }
export async function activeMember(db: QueryDatabase, workspaceId: string, userId: string) {
  const [member] = await db.select().from(t.memberships).where(and(
    eq(t.memberships.workspaceId, workspaceId), eq(t.memberships.userId, userId), isNull(t.memberships.revokedAt),
  ));
  if (!member) throw new ApiError(403, "MEMBERSHIP_REQUIRED");
  return member;
}

/** All operations lock workspace first, then project. Revocation uses the same lock. */
export async function lockAccess(db: QueryDatabase, actor: Actor, workspaceId: string) {
  const [workspace] = await db.select().from(t.workspaces).where(eq(t.workspaces.id, workspaceId)).for("update");
  if (!workspace) throw new ApiError(403, "MEMBERSHIP_REQUIRED");
  const member = await activeMember(db, workspaceId, actor.id);
  const [user] = await db.select().from(t.user).where(eq(t.user.id, actor.id));
  if (!user?.emailVerified) throw new ApiError(401, "VERIFIED_SESSION_REQUIRED");
  return { workspace, member };
}
export async function lockProject(db: QueryDatabase, workspaceId: string, projectId: string) {
  return requireValue((await db.select().from(t.projects).where(and(
    eq(t.projects.workspaceId, workspaceId), eq(t.projects.id, projectId),
  )).for("update"))[0]);
}

/** Offline operator action: no public route, no first-signup elevation. */
export async function bootstrapOwner(db: QueryDatabase, email: string) {
  await db.execute("select pg_advisory_xact_lock(116001,1602)");
  const [user] = await db.select().from(t.user).where(eq(t.user.email, email.trim().toLowerCase()));
  if (!user?.emailVerified) throw new ApiError(409, "VERIFIED_USER_REQUIRED");
  const [workspace] = await db.select().from(t.workspaces).where(eq(t.workspaces.id, WORKSPACE_ID)).for("update");
  if (workspace) {
    if (workspace.ownerUserId !== user.id) throw new ApiError(409, "OWNER_ALREADY_BOOTSTRAPPED");
    const member = await activeMember(db, workspace.id, user.id);
    if (member.role !== "owner") throw new ApiError(409, "OWNER_INCONSISTENT");
    return workspace.id;
  }
  await db.insert(t.workspaces).values({ id: WORKSPACE_ID, name: "MEDIUM", ownerUserId: user.id });
  await db.insert(t.memberships).values({ workspaceId: WORKSPACE_ID, userId: user.id, role: "owner" });
  return WORKSPACE_ID;
}
