import { randomUUID } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import * as t from "./db/schema";
import type { Database, QueryDatabase } from "./db/connection";
import type { Actor } from "./access";
import { lockAccess, lockProject } from "./access";
import { collaborationState } from "./outbox";
import { ApiError } from "./errors";
import { overlaps } from "./leasePlan";
import { hashPayload } from "./commandHash";
import type { LeaseProof } from "../src/application/v2/collaborationContracts";
import type { CommandEnvelope } from "../src/domain/v2/commands";

export const LEASE_SECONDS = 20;
const scopesSchema = z.array(z.string().max(180)).max(512);
const basisSchema = z.record(z.string(), z.string());
type Plan = { resources: string[]; basis: Record<string, string>; deltaHash: string };
const live = () => gt(t.editLeases.expiresAt, sql`clock_timestamp()`);
export async function pruneLeases(db: QueryDatabase, workspaceId: string) {
  await db.delete(t.editLeases).where(and(eq(t.editLeases.workspaceId, workspaceId), lte(t.editLeases.expiresAt, sql`clock_timestamp()`)));
}
export async function available(db: QueryDatabase, workspaceId: string, resources: string[], except?: string) {
  const leases = await db.select({ id: t.editLeases.id, resources: t.editLeases.resources }).from(t.editLeases).where(and(eq(t.editLeases.workspaceId, workspaceId), live()));
  if (leases.some((l) => l.id !== except && overlaps(resources, scopesSchema.parse(l.resources)))) throw new ApiError(409, "LEASE_BUSY");
}
function grantValue(row: typeof t.editLeases.$inferSelect) { return { id: row.id, fence: row.fence, expiresAt: row.expiresAt.toISOString(), baseRevision: row.baseRevision }; }
export async function grant(db: QueryDatabase, actor: Actor, e: CommandEnvelope, plan: Plan, revision: number, peopleRevision: number, requestHash: string) {
  await pruneLeases(db, e.workspaceId);
  const [old] = await db.select().from(t.editLeases).where(and(eq(t.editLeases.workspaceId, e.workspaceId), eq(t.editLeases.ownerId, actor.id), eq(t.editLeases.sessionId, actor.sessionId), eq(t.editLeases.commandId, e.commandId)));
  if (old) {
    if (old.requestHash !== requestHash) throw new ApiError(409, "COMMAND_ID_REUSED");
    return grantValue(old);
  }
  const owned = await db.select({ id: t.editLeases.id }).from(t.editLeases).where(and(eq(t.editLeases.workspaceId, e.workspaceId), eq(t.editLeases.ownerId, actor.id), live()));
  if (owned.length >= 4) throw new ApiError(429, "LEASE_LIMIT");
  await available(db, e.workspaceId, plan.resources);
  await collaborationState(db, e.workspaceId);
  const [state] = await db.update(t.collaborationState).set({ fence: sql`${t.collaborationState.fence} + 1` }).where(eq(t.collaborationState.workspaceId, e.workspaceId)).returning();
  if (!state) throw Error("Missing fencing counter");
  const [row] = await db.insert(t.editLeases).values({ id: randomUUID(), workspaceId: e.workspaceId, projectId: e.projectId, ownerId: actor.id, sessionId: actor.sessionId,
    commandId: e.commandId, requestHash, fence: state.fence, resources: scopesSchema.parse(plan.resources), basis: plan.basis, deltaHash: plan.deltaHash,
    baseRevision: revision, peopleRevision, expiresAt: sql`clock_timestamp() + interval '20 seconds'` }).returning();
  if (!row) throw Error("Missing lease grant");
  return grantValue(row);
}
/** A leased command may replan on a newer snapshot only with identical dependencies AND delta. */
export async function validate(db: QueryDatabase, actor: Actor, e: CommandEnvelope, proof: LeaseProof, plan: Plan, peopleRevision: number, requestHash: string) {
  const [lease] = await db.select().from(t.editLeases).where(and(eq(t.editLeases.id, proof.id), eq(t.editLeases.workspaceId, e.workspaceId), eq(t.editLeases.projectId, e.projectId), live()));
  if (!lease) throw new ApiError(409, "LEASE_STALE");
  if (lease.ownerId !== actor.id || lease.sessionId !== actor.sessionId) throw new ApiError(403, "LEASE_OWNER_REQUIRED");
  if (lease.fence !== proof.fence || lease.commandId !== e.commandId || lease.requestHash !== requestHash) throw new ApiError(409, "LEASE_STALE");
  if (lease.peopleRevision !== peopleRevision || hashPayload(scopesSchema.parse(lease.resources)) !== hashPayload(plan.resources)
    || hashPayload(basisSchema.parse(lease.basis)) !== hashPayload(plan.basis) || lease.deltaHash !== plan.deltaHash) throw new ApiError(409, "REVISION_CONFLICT");
  await available(db, e.workspaceId, plan.resources, proof.id);
}
export async function consume(db: QueryDatabase, proof: LeaseProof) {
  const rows = await db.delete(t.editLeases).where(and(eq(t.editLeases.id, proof.id), eq(t.editLeases.fence, proof.fence), live())).returning({ id: t.editLeases.id });
  if (!rows.length) throw new ApiError(409, "LEASE_STALE");
}
export class Leases {
  constructor(private readonly db: Database) {}
  async action(actor: Actor, workspaceId: string, projectId: string, id: string, fence: number, commandId: string, renew: boolean) {
    return this.db.transaction(async (db) => {
      await lockAccess(db, actor, workspaceId); await lockProject(db, workspaceId, projectId);
      const [receipt] = await db.select({ projectId: t.receipts.projectId }).from(t.receipts).where(and(eq(t.receipts.workspaceId, workspaceId), eq(t.receipts.actorId, actor.id), eq(t.receipts.commandId, commandId)));
      if (receipt?.projectId === projectId) return { committed: true };
      const [owner] = await db.select({ ownerId: t.editLeases.ownerId, sessionId: t.editLeases.sessionId }).from(t.editLeases).where(and(eq(t.editLeases.workspaceId, workspaceId), eq(t.editLeases.projectId, projectId), eq(t.editLeases.id, id)));
      if (owner && (owner.ownerId !== actor.id || owner.sessionId !== actor.sessionId)) throw new ApiError(403, "LEASE_OWNER_REQUIRED");
      const where = and(eq(t.editLeases.id, id), eq(t.editLeases.workspaceId, workspaceId), eq(t.editLeases.projectId, projectId), eq(t.editLeases.ownerId, actor.id), eq(t.editLeases.sessionId, actor.sessionId), eq(t.editLeases.fence, fence), eq(t.editLeases.commandId, commandId), live());
      if (!renew) { await db.delete(t.editLeases).where(where); return { released: true }; }
      // Bounded lifetime: an abandoned/repeated renewal cannot reserve an object forever.
      const [row] = await db.update(t.editLeases).set({ expiresAt: sql`least(clock_timestamp() + interval '20 seconds', ${t.editLeases.createdAt} + interval '90 seconds')` }).where(and(where, gt(sql`${t.editLeases.createdAt} + interval '90 seconds'`, sql`clock_timestamp()`))).returning();
      if (!row) throw new ApiError(409, "LEASE_STALE");
      return { lease: grantValue(row) };
    });
  }
}
