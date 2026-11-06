import { and, eq, lte, sql } from "drizzle-orm";
import type { QueryDatabase } from "./db/connection";
import * as t from "./db/schema";
import type { CommandResult } from "./commands";

export const EVENT_RETENTION = 2048;
export async function collaborationState(db: QueryDatabase, workspaceId: string) {
  await db.insert(t.collaborationState).values({ workspaceId }).onConflictDoNothing();
  const [state] = await db.select().from(t.collaborationState).where(eq(t.collaborationState.workspaceId, workspaceId));
  if (!state) throw Error("Missing collaboration state");
  return state;
}
/** Called under the existing workspace transaction lock. Rollback publishes nothing. */
export async function appendEvent(db: QueryDatabase, workspaceId: string, result: Omit<CommandResult, "commandId"> & { commandId: string | null }, resources: string[]) {
  if (!result.changed) return;
  await collaborationState(db, workspaceId);
  const [state] = await db.update(t.collaborationState).set({ sequence: sql`${t.collaborationState.sequence} + 1` }).where(eq(t.collaborationState.workspaceId, workspaceId)).returning();
  if (!state) throw Error("Missing collaboration cursor");
  await db.insert(t.workspaceEvents).values({ workspaceId, sequence: state.sequence, projectId: result.projectId, commandId: result.commandId,
    revision: result.revision, workspaceRevision: result.workspaceRevision, peopleRevision: result.peopleRevision, resources });
  await db.delete(t.workspaceEvents).where(and(eq(t.workspaceEvents.workspaceId, workspaceId), lte(t.workspaceEvents.sequence, state.sequence - EVENT_RETENTION)));
}
