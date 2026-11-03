import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { planCommand } from "../src/domain/v2/commands";
import type { CommandEnvelope } from "../src/domain/v2/commands";
import { applyPeople, newPerson } from "../src/domain/v2/people";
import type { PeopleEnvelope } from "../src/domain/v2/people";
import { activeAssignment, catalogSchema } from "../src/domain/v2/peopleModel";
import { snapshotSchema } from "../src/domain/v2/model";
import type { Snapshot } from "../src/domain/v2/model";
import { createTemplate } from "../src/domain/v2/template";
import { cloneProject } from "../src/application/v2/cloneProject";
import { PostgresRepository } from "./db/repository";
import type { Database, QueryDatabase } from "./db/connection";
import * as t from "./db/schema";
import { lockAccess, lockProject } from "./access";
import type { Actor } from "./access";
import type { CreateProject, WorkspaceCommand } from "./dto";
import { ApiError, requireValue } from "./errors";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const hashPayload = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export interface CommandResult { commandId: string; projectId: string | null; revision: number; workspaceRevision: number; peopleRevision: number; changed: boolean }

function limits(d: Snapshot, workspace: typeof t.workspaces.$inferSelect) {
  if (d.processes.length > workspace.maxProcesses || d.processes.some((p) => d.tasks.filter((x) => x.processId === p.id).length > workspace.maxTasks)) throw new ApiError(409, "WORK_LIMIT");
}
function planned<T>(fn: () => T): T {
  try { return fn(); } catch { throw new ApiError(422, "COMMAND_REJECTED"); }
}
type Context = Awaited<ReturnType<typeof lockAccess>> & { db: QueryDatabase; repo: PostgresRepository };
export class ServerCommands {
  constructor(readonly db: Database) {}

  private async run(actor: Actor, input: { commandId: string; workspaceId: string }, operation: string, execute: (c: Context) => Promise<Omit<CommandResult, "commandId">>): Promise<CommandResult> {
    return this.db.transaction(async (db) => {
      const access = await lockAccess(db, actor, input.workspaceId);
      const hash = hashPayload({ operation, input });
      const scope = and(eq(t.receipts.workspaceId, input.workspaceId), eq(t.receipts.actorId, actor.id), eq(t.receipts.commandId, input.commandId));
      const [receipt] = await db.select().from(t.receipts).where(scope);
      if (receipt) {
        if (receipt.payloadHash !== hash) throw new ApiError(409, "COMMAND_ID_REUSED");
        return receipt.result as CommandResult;
      }
      const result: CommandResult = { commandId: input.commandId, ...await execute({ db, repo: new PostgresRepository(db, input.workspaceId, actor.id), ...access }) };
      await db.insert(t.receipts).values({ workspaceId: input.workspaceId, actorId: actor.id, commandId: input.commandId, projectId: result.projectId, payloadHash: hash, result });
      await db.insert(t.auditEvents).values({ id: randomUUID(), workspaceId: input.workspaceId, actorId: actor.id, commandId: input.commandId, projectId: result.projectId, kind: operation, revision: result.revision });
      return result;
    });
  }

  async project(actor: Actor, e: CommandEnvelope) {
    return this.run(actor, e, `project:${e.projectId}`, async ({ db, repo, workspace }) => {
      const row = await lockProject(db, e.workspaceId, e.projectId);
      if (row.revision !== e.expectedRevision) throw new ApiError(409, "REVISION_CONFLICT");
      if (row.archivedAt) throw new ApiError(409, "PROJECT_ARCHIVED");
      const before = requireValue(await repo.load(e.projectId)), catalog = await repo.loadCatalog();
      const command = e.command;
      const createdPerson = command.type === "CreatePersonAndAssign" ? planned(() => newPerson(catalog, command.personId, command.fields)) : undefined;
      const nextCatalog = createdPerson ? catalogSchema.parse({ ...catalog, revision: catalog.revision + 1, people: [...catalog.people, createdPerson] }) : catalog;
      if (nextCatalog.people.filter((p) => !p.archivedAt).length > workspace.maxPeople) throw new ApiError(409, "PEOPLE_LIMIT");
      const { document: after } = planned(() => planCommand(before, e.command, nextCatalog));
      limits(after, workspace);
      if (after !== before) {
        if (createdPerson) await repo.saveCatalog(nextCatalog);
        await repo.write({ ...after, project: { ...after.project, updatedAt: new Date().toISOString() } }, before.project.revision);
      }
      return { projectId: e.projectId, revision: after.project.revision, workspaceRevision: workspace.revision, peopleRevision: nextCatalog.revision, changed: after !== before };
    });
  }

  async create(actor: Actor, e: CreateProject) {
    return this.run(actor, e, "CreateProject", async ({ db, repo, workspace }) => {
      if (e.expectedRevision !== workspace.revision) throw new ApiError(409, "REVISION_CONFLICT");
      await this.projectLimit(db, workspace);
      const template = createTemplate(e.name, e.description, e.startDate, randomUUID, new Date().toISOString());
      const scope = { workspaceId: workspace.id };
      const d = snapshotSchema.parse({ ...template, project: { ...template.project, ...scope }, ...Object.fromEntries((["stages", "lanes", "processes", "tasks", "results", "resultPlacements", "checkpoints", "assignments"] as const).map((k) => [k, template[k].map((v) => ({ ...v, ...scope }))])) });
      await this.makeFirst(db, workspace.id);
      await repo.write(d, null);
      await this.advance(db, workspace.id);
      return { projectId: d.project.id, revision: 0, workspaceRevision: workspace.revision + 1, peopleRevision: workspace.peopleRevision, changed: true };
    });
  }

  async people(actor: Actor, e: PeopleEnvelope) {
    return this.run(actor, e, "PeopleCommand", async ({ repo, workspace }) => {
      if (e.expectedRevision !== workspace.peopleRevision) throw new ApiError(409, "REVISION_CONFLICT");
      const catalog = await repo.loadCatalog();
      // Archival needs active assignment snapshots from every affected project, not all project contents.
      const documents: Snapshot[] = [];
      if (e.command.type === "ArchivePerson") {
        const refs = await repo.db.selectDistinct({ projectId: t.assignments.projectId }).from(t.assignments).where(and(eq(t.assignments.workspaceId, workspace.id), eq(t.assignments.personId, e.command.id)));
        for (const ref of refs) documents.push(requireValue(await repo.load(ref.projectId)));
      }
      const next = planned(() => applyPeople(catalog, e, documents, new Date().toISOString()));
      if (next.people.filter((p) => !p.archivedAt).length > workspace.maxPeople) throw new ApiError(409, "PEOPLE_LIMIT");
      if (next !== catalog) await repo.saveCatalog(next);
      return { projectId: null, revision: next.revision, workspaceRevision: workspace.revision, peopleRevision: next.revision, changed: next !== catalog };
    });
  }

  async workspace(actor: Actor, e: WorkspaceCommand) {
    return this.run(actor, e, "WorkspaceCommand", async ({ db, repo, workspace }) => {
      if (e.expectedRevision !== workspace.revision) throw new ApiError(409, "REVISION_CONFLICT");
      const c = e.command;
      let projectId: string | null = null, revision = workspace.revision;
      let changed: boolean;
      if (c.type === "ReorderProjects") {
        const rows = await db.select().from(t.projects).where(eq(t.projects.workspaceId, workspace.id)).orderBy(t.projects.sortIndex, t.projects.id);
        const existing = rows.map((r) => r.id), selected = new Set(c.order);
        if (c.order.some((id) => !existing.includes(id))) throw new ApiError(404, "NOT_FOUND");
        let index = 0;
        const order = existing.map((id) => selected.has(id) ? requireValue(c.order[index++]) : id);
        changed = order.some((id, i) => id !== existing[i]);
        if (changed) for (const [sortIndex, id] of order.entries()) await db.update(t.projects).set({ sortIndex }).where(and(eq(t.projects.workspaceId, workspace.id), eq(t.projects.id, id)));
      } else {
        const p = await lockProject(db, workspace.id, c.id);
        projectId = p.id; revision = p.revision;
        if (c.type === "ArchiveProject") {
          changed = !!p.archivedAt !== c.archived;
          if (changed) {
            if (!c.archived) await this.projectLimit(db, workspace);
            await db.update(t.projects).set({ archivedAt: c.archived ? new Date() : null, revision: p.revision + 1, updatedAt: new Date() }).where(and(eq(t.projects.workspaceId, workspace.id), eq(t.projects.id, c.id)));
            revision++;
          }
        } else {
          if (p.revision !== c.expectedProjectRevision) throw new ApiError(409, "REVISION_CONFLICT");
          if (p.archivedAt) throw new ApiError(409, "PROJECT_ARCHIVED");
          await this.projectLimit(db, workspace);
          const source = requireValue(await repo.load(p.id)), catalog = await repo.loadCatalog();
          source.assignments = source.assignments.filter((a) => activeAssignment(a, catalog));
          const copy = cloneProject(source, randomUUID, () => new Date().toISOString());
          copy.project.sortIndex = 0;
          await this.makeFirst(db, workspace.id);
          await repo.write(copy, null);
          projectId = copy.project.id; revision = 0; changed = true;
        }
      }
      if (changed) await this.advance(db, workspace.id);
      return { projectId, revision, workspaceRevision: workspace.revision + Number(changed), peopleRevision: workspace.peopleRevision, changed };
    });
  }
  private async projectLimit(db: QueryDatabase, workspace: typeof t.workspaces.$inferSelect) {
    const [{ value } = { value: 0 }] = await db.select({ value: sql<number>`count(*)::int` }).from(t.projects).where(and(eq(t.projects.workspaceId, workspace.id), isNull(t.projects.archivedAt)));
    if (value >= workspace.maxProjects) throw new ApiError(409, "PROJECT_LIMIT");
  }
  private async makeFirst(db: QueryDatabase, workspaceId: string) {
    await db.update(t.projects).set({ sortIndex: sql`${t.projects.sortIndex} + 1` }).where(eq(t.projects.workspaceId, workspaceId));
  }
  private async advance(db: QueryDatabase, workspaceId: string) {
    await db.update(t.workspaces).set({ revision: sql`${t.workspaces.revision} + 1` }).where(eq(t.workspaces.id, workspaceId));
  }
}
