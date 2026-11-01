import {
  catalogSchema,
  emptyCatalog,
  activeAssignment,
} from "../../domain/v2/peopleModel";
import type { CatalogState } from "../../domain/v2/peopleModel";
import type { PeopleCommit } from "../../application/v2/ports";
import type { StoredHistory } from "../../application/v2/history";
import { historyKey } from "../../application/v2/history";
import { Dexie } from "dexie";
import type { Table } from "dexie";
import {
  snapshotSchema,
  normalizeView,
  WORKSPACE_ID,
} from "../../domain/v2/model";
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
  workspaceData!: Table<{ key: string; value: unknown }, string>;
  history!: Table<StoredHistory, string>;
  documents!: Table<Snapshot, string>;
  preferences!: Table<{ key: string; value: unknown }, string>;
  constructor(name = "timeline-workspace-v2") {
    super(name);
    this.version(2).stores({
      documents: "&project.id,project.updatedAt",
      preferences: "&key",
    });
    this.version(3).stores({ history: "&key" });
    this.version(4).stores({ workspaceData: "&key" });
  }
}
export class V2Repository {
  readonly db: V2Database;
  constructor(db = new V2Database()) {
    this.db = db;
  }
  async loadCatalog() {
    const row = await this.db.workspaceData.get("people");
    const catalog = row
      ? catalogSchema.parse(row.value)
      : emptyCatalog(WORKSPACE_ID);
    if (catalog.workspaceId !== WORKSPACE_ID)
      throw Error(
        "Справочник принадлежит другому пространству. Данные не сброшены",
      );
    return catalog;
  }
  async peopleTransaction(
    expected: number,
    change: (catalog: CatalogState, documents: Snapshot[]) => CatalogState,
  ) {
    return this.db.transaction(
      "rw",
      this.db.workspaceData,
      this.db.documents,
      async () => {
        const old = await this.loadCatalog();
        if (old.revision !== expected)
          throw Error(
            "Справочник изменён в другой вкладке. Обновите данные и повторите",
          );
        const next = change(old, await this.all());
        if (next === old) return old;
        if (next.revision !== old.revision + 1)
          throw Error("Неверная ревизия справочника");
        const parsed = catalogSchema.parse(next);
        await this.db.workspaceData.put({ key: "people", value: parsed });
        return parsed;
      },
    );
  }
  private async saveCatalogChange(
    change: PeopleCommit | undefined,
    document?: Snapshot,
  ) {
    if (!change) return;
    const current = await this.loadCatalog();
    if (current.revision !== change.expectedRevision)
      throw Error(
        "Справочник изменён в другой вкладке. Данные не перезаписаны",
      );
    if (!change.next) return;
    const next = catalogSchema.parse(change.next);
    if (next.revision !== current.revision + 1)
      throw Error("Неверная ревизия справочника");
    const removed = new Set(
      current.people
        .filter((p) => !next.people.some((x) => x.id === p.id))
        .map((p) => p.id),
    );
    if (removed.size) {
      const docs = (await this.all()).map((d) =>
        d.project.id === document?.project.id ? document : d,
      );
      if (
        docs.some((d) =>
          d.assignments.some(
            (a) =>
              a.personId &&
              removed.has(a.personId) &&
              activeAssignment(a, current),
          ),
        )
      )
        throw Error(
          "Исполнитель уже используется в другом назначении. Отмена не записана",
        );
    }
    await this.db.workspaceData.put({ key: "people", value: next });
  }
  async loadHistory(id: string) {
    return (await this.db.history.get(historyKey(id))) ?? null;
  }
  async commit(
    d: Snapshot,
    expected: number,
    history: StoredHistory,
    expectedHistoryToken: string | null,
    archiveOld: boolean,
    people?: PeopleCommit,
  ) {
    await this.db.transaction(
      "rw",
      this.db.documents,
      this.db.preferences,
      this.db.history,
      this.db.workspaceData,
      async () => {
        await this.saveCatalogChange(people, d);
        const old = await this.loadHistory(d.project.id);
        if (
          (old?.token ?? null) !== expectedHistoryToken ||
          history.key !== historyKey(d.project.id)
        )
          throw new RevisionConflict();
        if (archiveOld && old)
          await this.db.history.add({
            ...old,
            key: `archive:${d.project.id}:${history.token}`,
          });
        await this.save(d, expected);
        await this.db.history.put(history);
      },
    );
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
    await this.db.transaction(
      "rw",
      this.db.documents,
      this.db.preferences,
      async () => {
        const old = await this.load(d.project.id);
        if (
          expected === null ? !!old : !old || old.project.revision !== expected
        )
          throw new RevisionConflict();
        if (value.project.revision !== (expected === null ? 0 : expected + 1))
          throw Error("Неверная ревизия");
        await this.db.documents.put(value);
        const key = `editor:${value.project.id}`,
          row = await this.db.preferences.get(key);
        if (row)
          await this.db.preferences.put({
            key,
            value: normalizeView(value, viewPreferencesSchema.parse(row.value)),
          });
      },
    );
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
    await this.db.transaction(
      "rw",
      this.db.documents,
      this.db.preferences,
      async () => {
        const document = await this.load(id);
        if (!document) throw new RevisionConflict();
        await this.db.preferences.put({
          key: `editor:${id}`,
          value: normalizeView(document, viewPreferencesSchema.parse(view)),
        });
      },
    );
  }

  async insertBatch(
    values: Snapshot[],
    preferences?: WorkspacePreferences,
    people?: PeopleCommit,
  ) {
    const parsed = values.map((d) => snapshotSchema.parse(d));
    await this.db.transaction(
      "rw",
      this.db.documents,
      this.db.preferences,
      this.db.workspaceData,
      async () => {
        await this.saveCatalogChange(people);
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
            d.assignments,
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
