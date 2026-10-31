import { planCommand, envelopeSchema } from "../../domain/v2/commands";
import type { CommandEnvelope, ContentCommand } from "../../domain/v2/commands";
import { createTemplate } from "../../domain/v2/template";
import {
  snapshotSchema,
  normalizeView,
  WORKSPACE_ID,
} from "../../domain/v2/model";
import type { Snapshot } from "../../domain/v2/model";
import type { DateOnly } from "../../domain";
import type { V2RepositoryPort } from "./ports";
import { v2BackupSchema } from "./backup";
import type { V2Backup } from "./backup";
import type { ViewPreferences, ProjectId } from "../../domain";
import type { WorkspacePreferences } from "../workspace/model";
import { RevisionConflict } from "../workspace/model";
type Entry = { before: Snapshot; after: Snapshot };
type History = { undo: Entry[]; redo: Entry[]; revision: number };
export class CommandService {
  private histories = new Map<string, History>();
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
    await this.repository.save(saved, before.project.revision);
    const prior = this.histories.get(e.projectId);
    const undo = prior?.revision === before.project.revision ? prior.undo : [];
    this.histories.set(e.projectId, {
      undo: [...undo, { before, after: saved }],
      redo: [],
      revision: saved.project.revision,
    });
  }
  history(id: string) {
    const h = this.histories.get(id);
    return { canUndo: !!h?.undo.length, canRedo: !!h?.redo.length };
  }
  async undo(id: string, redo = false) {
    const h = this.histories.get(id),
      entry = redo ? h?.redo.at(-1) : h?.undo.at(-1);
    if (!h || !entry) return;
    const current = await this.source(id, h.revision),
      target = redo ? entry.after : entry.before;
    const restore = <T extends { id: string; revision: number }>(
      values: T[],
      present: T[],
    ): T[] =>
      values.map((value) => {
        const old = present.find((e) => e.id === value.id);
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
      viewPreferences: normalizeView(target, current.viewPreferences),
    });
    await this.repository.save(next, current.project.revision);
    this.histories.set(id, {
      undo: redo ? [...h.undo, entry] : h.undo.slice(0, -1),
      redo: redo ? h.redo.slice(0, -1) : [...h.redo, entry],
      revision: next.project.revision,
    });
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
    return { documents, preferences, views };
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
