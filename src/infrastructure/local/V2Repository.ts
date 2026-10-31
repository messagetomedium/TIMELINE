import { Dexie } from "dexie";
import type { Table } from "dexie";
import { snapshotSchema, WORKSPACE_ID } from "../../domain/v2/model";
import type { Snapshot } from "../../domain/v2/model";
import { viewPreferencesSchema } from "../../domain";
import type { ViewPreferences } from "../../domain";
import {
  defaultPreferences,
  RevisionConflict,
  workspacePreferencesSchema,
} from "../../application/workspace/model";
import type { WorkspacePreferences } from "../../application/workspace/model";
export class V2Database extends Dexie {
  documents!: Table<Snapshot, string>;
  preferences!: Table<{ key: string; value: unknown }, string>;
  constructor(name = "timeline-workspace-v2") {
    super(name);
    this.version(2).stores({
      documents: "&project.id,project.updatedAt",
      preferences: "&key",
    });
  }
}
export class V2Repository {
  readonly db: V2Database;
  constructor(db = new V2Database()) {
    this.db = db;
  }
  async all() {
    return (await this.db.documents.toArray())
      .map((d) => snapshotSchema.parse(d))
      .sort(
        (a, b) =>
          b.project.createdAt.localeCompare(a.project.createdAt) ||
          a.project.id.localeCompare(b.project.id),
      );
  }
  async load(id: string) {
    const d = await this.db.documents.get(id);
    return d ? snapshotSchema.parse(d) : null;
  }
  async save(d: Snapshot, expected: number | null) {
    const value = snapshotSchema.parse(d);
    await this.db.transaction("rw", this.db.documents, async () => {
      const old = await this.load(d.project.id);
      if (expected === null ? !!old : !old || old.project.revision !== expected)
        throw new RevisionConflict();
      if (value.project.revision !== (expected === null ? 0 : expected + 1))
        throw Error("Неверная ревизия");
      await this.db.documents.put(value);
    });
  }
  async preferences() {
    return workspacePreferencesSchema.parse(
      (await this.db.preferences.get("workspace"))?.value ?? defaultPreferences,
    );
  }
  async savePreferences(p: WorkspacePreferences) {
    await this.db.preferences.put({
      key: "workspace",
      value: workspacePreferencesSchema.parse(p),
    });
  }
  async views() {
    const result: Record<string, ViewPreferences> = {};
    for (const row of await this.db.preferences
      .where("key")
      .startsWith("editor:")
      .toArray()) {
      const v = viewPreferencesSchema.parse(row.value);
      result[v.projectId] = v;
    }
    return result;
  }
  async saveView(id: string, view: ViewPreferences) {
    if (id !== view.projectId) throw Error("Чужой вид");
    await this.db.preferences.put({
      key: `editor:${id}`,
      value: viewPreferencesSchema.parse(view),
    });
  }
  async insertBatch(values: Snapshot[], preferences?: WorkspacePreferences) {
    const parsed = values.map((d) => snapshotSchema.parse(d));
    await this.db.transaction(
      "rw",
      this.db.documents,
      this.db.preferences,
      async () => {
        const existing = await this.all();
        if (
          existing.filter((d) => !d.project.archivedAt).length +
            parsed.filter((d) => !d.project.archivedAt).length >
          40
        )
          throw Error("Лимит: 40 активных проектов. Данные не изменены.");
        const entityIds = (d: Snapshot) => [
          d.project.id,
          ...[
            d.stages,
            d.lanes,
            d.processes,
            d.tasks,
            d.results,
            d.checkpoints,
          ].flatMap((list) => list.map((e) => e.id)),
        ];
        const seen = new Set(existing.flatMap(entityIds));
        for (const d of parsed) {
          if (d.project.workspaceId !== WORKSPACE_ID)
            throw Error("Чужое пространство");
          for (const id of entityIds(d)) {
            if (seen.has(id))
              throw Error("Совпадение ID. Импортируйте как копии.");
            seen.add(id);
          }
          await this.db.documents.add(d);
        }
        if (preferences) await this.savePreferences(preferences);
      },
    );
  }
}
