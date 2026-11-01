import { projectSummarySchema, portfolioStateSchema, emptyPortfolio } from "../../application/v2/portfolio";
import type { ProjectSummary, PortfolioState, PortfolioCommand } from "../../application/v2/portfolio";
import { readHistory, makeHistory } from "../../application/v2/history";
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
  summaries!: Table<ProjectSummary, string>;
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
    this.version(5).stores({ summaries: "&project.id,project.createdAt" }).upgrade(async (tx) => {
      const documents = await tx.table<Snapshot>("documents").toArray();
      await tx.table("summaries").bulkPut(documents.map((d) => projectSummarySchema.parse({ project: d.project })));
    });
  }
}
export class V2Repository {
  readonly db: V2Database;
  constructor(db = new V2Database()) {
    this.db = db;
  }
  async summaries() {
    return (await this.db.summaries.toArray()).map((d) => projectSummarySchema.parse(d))
      .sort((a,b) => b.project.createdAt.localeCompare(a.project.createdAt) || a.project.id.localeCompare(b.project.id));
  }
  async loadPortfolio(): Promise<PortfolioState> {
    return portfolioStateSchema.parse((await this.db.workspaceData.get("portfolio"))?.value ?? emptyPortfolio());
  }
  async portfolioCommand(expected: number, command: PortfolioCommand | "undo" | "redo", now: string) {
    return this.db.transaction("rw", [this.db.workspaceData, this.db.documents, this.db.summaries, this.db.history, this.db.preferences], async () => {
      const state = await this.loadPortfolio();
      if (state.revision !== expected) throw new RevisionConflict();
      const summaries = await this.summaries();
      const known = new Set<string>(summaries.map((d) => d.project.id));
      const currentOrder = [...state.order.filter((id) => known.has(id)), ...summaries.map((d) => d.project.id).filter((id) => !state.order.includes(id))];
      let entry: PortfolioState["undo"][number] | undefined;
      const undo = command === "undo", redo = command === "redo";
      if (undo || redo) entry = (undo ? state.undo : state.redo).at(-1);
      else if (command.type === "ArchiveProject") {
        const summary = summaries.find((d) => d.project.id === command.id);
        if (!summary) throw new RevisionConflict();
        if (!!summary.project.archivedAt === command.archived) return state;
        entry = { kind: "archive", id: command.id, before: summary.project.archivedAt, after: command.archived ? now : null };
      } else {
        if (new Set(command.order).size !== command.order.length || command.order.some((id) => !known.has(id))) throw Error("Неверный порядок проектов");
        const moved = new Set(command.order); let index = 0;
        const after = currentOrder.map((id) => moved.has(id) ? command.order[index++] ?? id : id);
        if (JSON.stringify(after) === JSON.stringify(currentOrder)) return state;
        entry = { kind: "order", before: currentOrder, after };
      }
      if (!entry) return state;
      let order = currentOrder;
      if (entry.kind === "archive") {
        const d = await this.load(entry.id);
        const target = undo ? entry.before : entry.after;
        const expectedFlag = undo ? entry.after : entry.before;
        if (!d || d.project.workspaceId !== WORKSPACE_ID || d.project.archivedAt !== expectedFlag) throw new RevisionConflict();
        if (!target && summaries.filter((v) => !v.project.archivedAt).length >= 40) throw Error("Лимит: 40 активных проектов. Восстановление не выполнено.");
        const next = { ...d, project: { ...d.project, archivedAt: target, revision: d.project.revision + 1, updatedAt: now } };
        const row = await this.loadHistory(entry.id), h = readHistory(row, d);
        if (row && !h) await this.db.history.add({ ...row, key: `archive:${entry.id}:${crypto.randomUUID()}` });
        const rebase = (list: NonNullable<typeof h>["undo"]) => list.map((e) => ({ ...e, before: { ...e.before, project: { ...e.before.project, archivedAt: target } }, after: { ...e.after, project: { ...e.after.project, archivedAt: target } } }));
        await this.save(next, d.project.revision);
        await this.db.history.put({ key: historyKey(entry.id), token: crypto.randomUUID(), value: makeHistory(next, rebase(h?.undo ?? []), rebase(h?.redo ?? [])) });
      } else {
        const expectedOrder = undo ? entry.after : entry.before;
        const wanted = undo ? entry.before : entry.after;
        const members = new Set(expectedOrder);
        if (JSON.stringify(currentOrder.filter((id) => members.has(id))) !== JSON.stringify(expectedOrder.filter((id) => known.has(id)))) throw new RevisionConflict();
        const values = wanted.filter((id) => known.has(id)); let index = 0;
        order = currentOrder.map((id) => members.has(id) ? values[index++] ?? id : id);
      }
      const next = portfolioStateSchema.parse({ ...state, order, revision: state.revision + 1,
        undo: undo ? state.undo.slice(0,-1) : [...state.undo, entry],
        redo: redo ? state.redo.slice(0,-1) : undo ? [...state.redo, entry] : [] });
      await this.db.workspaceData.put({ key: "portfolio", value: next });
      return next;
    });
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
      this.db.summaries,
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
      this.db.summaries,
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
      this.db.summaries,
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
        await this.db.summaries.put({ project: value.project });
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
      this.db.summaries,
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
    portfolioOrder?: string[],
  ) {
    const parsed = values.map((d) => snapshotSchema.parse(d));
    await this.db.transaction(
      "rw",
      this.db.documents,
      this.db.summaries,
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
          await this.db.summaries.add({ project: d.project });
        }
        if (parsed.length) {
          const state = await this.loadPortfolio();
          const imported = new Set<string>(parsed.map((d) => d.project.id));
          const ordered = (portfolioOrder ?? parsed.map((d) => d.project.id)).filter((id) => imported.has(id));
          const rest = parsed.map((d) => d.project.id).filter((id) => !ordered.includes(id));
          await this.db.workspaceData.put({ key: "portfolio", value: { ...state, revision: state.revision + 1, order: [...ordered, ...rest, ...state.order.filter((id) => !imported.has(id))] } });
        }
        if (preferences) await this.savePreferences(preferences);
      },
    );
  }
}
