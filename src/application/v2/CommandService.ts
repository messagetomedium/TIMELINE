import { planCommand, envelopeSchema } from "../../domain/v2/commands";
import type { CommandEnvelope, ContentCommand } from "../../domain/v2/commands";
import { createTemplate } from "../../domain/v2/template";
import {
  snapshotSchema,
  normalizeView,
  WORKSPACE_ID,
  entityId,
} from "../../domain/v2/model";
import type { Snapshot } from "../../domain/v2/model";
import type { DateOnly } from "../../domain";
import type { V2RepositoryPort } from "./ports";
import { v2BackupSchema } from "./backup";
import type { V2Backup } from "./backup";
import type { ViewPreferences, ProjectId } from "../../domain";
import type { WorkspacePreferences } from "../workspace/model";
import { RevisionConflict } from "../workspace/model";
import {
  readHistory,
  makeHistory,
  historyKey,
  HISTORY_CONFLICT,
} from "./history";
import type { LocalHistory } from "./history";
export class CommandService {
  private histories = new Map<string, LocalHistory>();
  private ownRevisions = new Map<string, Map<number, number>>();
  readonly repository: V2RepositoryPort;
  private id: () => string;
  private now: () => string;
  constructor(
    repository: V2RepositoryPort,
    id: () => string = () => crypto.randomUUID(),
    now = () => new Date().toISOString(),
  ) {
    this.repository = repository;
    this.id = id;
    this.now = now;
  }
  private async source(id: string, revision: number) {
    const d = await this.repository.load(id);
    if (!d || d.project.revision !== revision) throw new RevisionConflict();
    return d;
  }
  async create(input: {
    type: "CreateProject";
    name: string;
    description: string;
    startDate: DateOnly;
  }) {
    const d = createTemplate(
      input.name,
      input.description,
      input.startDate,
      this.id,
      this.now(),
    );
    await this.repository.insertBatch([d]);
    return d.project.id;
  }
  envelope(d: Snapshot, command: ContentCommand): CommandEnvelope {
    return {
      commandId: this.id(),
      version: 1,
      workspaceId: d.project.workspaceId,
      projectId: d.project.id,
      expectedRevision: d.project.revision,
      command,
    };
  }
  /** Rebase queued field edits only across revisions committed by this service instance. */
  async executeLocal(input: CommandEnvelope) {
    let revision = input.expectedRevision;
    const links = this.ownRevisions.get(input.projectId);
    while (links?.has(revision)) revision = links.get(revision) ?? revision;
    return this.execute({ ...input, expectedRevision: revision });
  }
  private committed(
    id: string,
    before: number,
    after: number,
    h: LocalHistory,
  ) {
    const links = this.ownRevisions.get(id) ?? new Map<number, number>();
    links.set(before, after);
    this.ownRevisions.set(id, links);
    this.histories.set(id, h);
  }
  async execute(input: CommandEnvelope) {
    const e = envelopeSchema.parse(input);
    if (e.workspaceId !== WORKSPACE_ID)
      throw Error("Неверное пространство или версия команды");
    const before = await this.source(e.projectId, e.expectedRevision);
    if (before.project.workspaceId !== e.workspaceId)
      throw Error("Чужое пространство");
    const { document: after } = planCommand(before, e.command);
    if (after === before) return;
    const saved = {
      ...after,
      project: { ...after.project, updatedAt: this.now() },
    };
    const row = await this.repository.loadHistory(e.projectId),
      prior = readHistory(row, before);
    const history = makeHistory(
      saved,
      [...(prior?.undo ?? []), { before, after: saved }],
      [],
    );
    await this.repository.commit(
      saved,
      before.project.revision,
      { key: historyKey(e.projectId), token: this.id(), value: history },
      row?.token ?? null,
      !!row && !prior,
    );
    this.committed(
      e.projectId,
      before.project.revision,
      saved.project.revision,
      history,
    );
  }
  history(id: string) {
    const h = this.histories.get(id);
    return { canUndo: !!h?.undo.length, canRedo: !!h?.redo.length };
  }
  async undo(id: string, redo = false) {
    const current = await this.repository.load(id);
    if (!current) throw new RevisionConflict();
    const cached = this.histories.get(id);
    if (cached && cached.revision !== current.project.revision)
      throw Error(HISTORY_CONFLICT);
    const row = await this.repository.loadHistory(id),
      h = readHistory(row, current);
    if (row && !h) throw Error(HISTORY_CONFLICT);
    const entry = redo ? h?.redo.at(-1) : h?.undo.at(-1);
    if (!h || !entry) return;
    const target = redo ? entry.after : entry.before;
    const restore = <
      T extends ({ id: string } | { resultId: string }) & { revision: number },
    >(
      values: T[],
      present: T[],
    ): T[] =>
      values.map((value) => {
        const old = present.find((e) => entityId(e) === entityId(value));
        const fields = (v: T) =>
          JSON.stringify(
            Object.fromEntries(
              Object.entries(v).filter(([key]) => key !== "revision"),
            ),
          );
        return {
          ...value,
          revision: old
            ? old.revision + (fields(value) === fields(old) ? 0 : 1)
            : Math.max(value.revision, current.project.revision) + 1,
        };
      });
    const next = snapshotSchema.parse({
      ...target,
      project: {
        ...target.project,
        revision: current.project.revision + 1,
        updatedAt: this.now(),
      },
      stages: restore(target.stages, current.stages),
      processes: restore(target.processes, current.processes),
      tasks: restore(target.tasks, current.tasks),
      checkpoints: restore(target.checkpoints, current.checkpoints),
      results: restore(target.results, current.results),
      resultPlacements: restore(
        target.resultPlacements,
        current.resultPlacements,
      ),
      viewPreferences: normalizeView(target, current.viewPreferences),
    });
    const history = makeHistory(
      next,
      redo ? [...h.undo, entry] : h.undo.slice(0, -1),
      redo ? h.redo.slice(0, -1) : [...h.redo, entry],
    );
    await this.repository.commit(
      next,
      current.project.revision,
      { key: historyKey(id), token: this.id(), value: history },
      row?.token ?? null,
      false,
    );
    this.committed(
      id,
      current.project.revision,
      next.project.revision,
      history,
    );
  }
  clone(source: Snapshot) {
    const ids = new Map<string, string>();
    for (const value of [
      source.project,
      ...source.stages,
      ...source.lanes,
      ...source.processes,
      ...source.tasks,
      ...source.checkpoints,
      ...source.results,
    ])
      ids.set(value.id, this.id());
    // Replace UUID values only, never text that happens to contain an ID.
    const links = new Set([
      "id",
      "projectId",
      "stageId",
      "resultId",
      "processId",
      "laneId",
      "expandedProcessIds",
    ]);
    const remap = (v: unknown, key = ""): unknown =>
      typeof v === "string" && links.has(key)
        ? (ids.get(v) ?? v)
        : Array.isArray(v)
          ? v.map((x) => remap(x, key))
          : v && typeof v === "object"
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [k, remap(x, k)]),
              )
            : v;
    const d = snapshotSchema.parse(remap(source));
    const now = this.now();
    d.project = {
      ...d.project,
      name: `${source.project.name} — копия`,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    return d;
  }
  async snapshot() {
    const [documents, preferences, views] = await Promise.all([
      this.repository.all(),
      this.repository.preferences(),
      this.repository.views(),
    ]);
    const historyIssues: string[] = [];
    await Promise.all(
      documents.map(async (d) => {
        const row = await this.repository.loadHistory(d.project.id),
          h = readHistory(row, d);
        if (h) this.histories.set(d.project.id, h);
        else this.histories.delete(d.project.id);
        if (row && !h)
          historyIssues.push(`${d.project.name}: ${HISTORY_CONFLICT}`);
      }),
    );
    return { documents, preferences, views, historyIssues };
  }
  saveView(id: ProjectId, view: ViewPreferences) {
    return this.repository.saveView(id, view);
  }
  savePreferences(value: WorkspacePreferences) {
    return this.repository.savePreferences(value);
  }
  async exportBackup() {
    const snapshot = await this.snapshot();
    return JSON.stringify(
      v2BackupSchema.parse({
        format: "timeline-backup",
        version: 2,
        exportedAt: this.now(),
        documents: snapshot.documents,
        preferences: snapshot.preferences,
      }),
      null,
      2,
    );
  }
  async previewImport(text: string) {
    const backup = v2BackupSchema.parse(JSON.parse(text));
    const existing = await this.repository.all();
    return {
      backup,
      collisions: backup.documents.filter((d) =>
        existing.some((x) => x.project.id === d.project.id),
      ).length,
    };
  }
  async importBackup(backup: V2Backup, copies: boolean) {
    const parsed = v2BackupSchema.parse(backup);
    await this.repository.insertBatch(
      copies ? parsed.documents.map((d) => this.clone(d)) : parsed.documents,
      parsed.preferences,
    );
  }
  async duplicate(id: string) {
    const source = await this.repository.load(id);
    if (!source) throw new RevisionConflict();
    const d = this.clone(source);
    await this.repository.insertBatch([d]);
    return d.project.id;
  }
}
