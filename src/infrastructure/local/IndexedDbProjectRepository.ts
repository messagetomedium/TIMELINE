import { Dexie } from 'dexie';
import type { Table } from 'dexie';
import { projectDocumentSchema, viewPreferencesSchema } from '../../domain';
import type { ProjectDocument, ProjectId, ViewPreferences } from '../../domain';
import { defaultPreferences, RevisionConflict, scopedIds, workspacePreferencesSchema } from '../../application/workspace/model';
import type { WorkspacePreferences, WorkspaceRepository } from '../../application/workspace/model';

interface DocumentRow { id: string; revision: number; updatedAt: string; value: ProjectDocument }
interface ValueRow { key: string; value: unknown }

export class WorkspaceDatabase extends Dexie {
  documents!: Table<DocumentRow, string>;
  preferences!: Table<ValueRow, string>;
  metadata!: Table<ValueRow, string>;
  constructor(name = 'timeline-workspace') {
    super(name);
    this.version(1).stores({ documents: '&id,revision,updatedAt', preferences: '&key', metadata: '&key' });
  }
}
const record = (value: ProjectDocument): DocumentRow => ({ id: value.project.id, revision: value.project.revision, updatedAt: value.project.updatedAt, value });
function parsed(row: DocumentRow): ProjectDocument {
  const value = projectDocumentSchema.parse(row.value);
  if (value.project.id !== row.id || value.project.revision !== row.revision) throw new Error('Повреждена запись проекта. Восстановите её из резервной копии.');
  return value;
}

export class IndexedDbProjectRepository implements WorkspaceRepository {
  readonly database: WorkspaceDatabase;
  constructor(database = new WorkspaceDatabase()) { this.database = database; }
  async initialize(seed: ProjectDocument): Promise<void> {
    const value = projectDocumentSchema.parse(seed);
    await this.database.transaction('rw', this.database.documents, this.database.preferences, this.database.metadata, async () => {
      const schema = await this.database.metadata.get('schemaVersion');
      if (schema && schema.value !== 1) throw new Error('Версия локальной базы не поддерживается. Данные не изменены.');
      if (!(await this.database.metadata.get('initialized'))) {
        if (await this.database.documents.count() === 0) await this.database.documents.add(record(value));
        await this.database.metadata.put({ key: 'initialized', value: true });
      }
      await this.database.metadata.put({ key: 'schemaVersion', value: 1 });
      if (!(await this.database.preferences.get('workspace'))) await this.database.preferences.add({ key: 'workspace', value: defaultPreferences });
    });
  }
  async all(): Promise<readonly ProjectDocument[]> {
    return this.database.transaction('r', this.database.documents, this.database.preferences, async () => {
      const rows = await this.database.documents.toArray();
      const views = await this.views();
      return rows.map((row) => projectDocumentSchema.parse({ ...parsed(row), viewPreferences: views[row.id] ?? row.value.viewPreferences }))
        .sort((a, b) => a.project.sortIndex - b.project.sortIndex || a.project.id.localeCompare(b.project.id));
    });
  }
  async list() { return (await this.all()).map((document) => document.project); }
  async load(id: ProjectId): Promise<ProjectDocument | null> { return (await this.all()).find((document) => document.project.id === id) ?? null; }
  async save(document: ProjectDocument, expectedRevision: number | null): Promise<void> {
    const value = projectDocumentSchema.parse(document);
    await this.database.transaction('rw', this.database.documents, this.database.preferences, async () => {
      const current = await this.database.documents.get(value.project.id);
      if (expectedRevision === null ? Boolean(current) : !current || current.revision !== expectedRevision) throw new RevisionConflict();
      if (value.project.revision !== (expectedRevision === null ? 0 : expectedRevision + 1)) throw new Error('Некорректная ревизия проекта.');
      await this.database.documents.put(record(value));
      if (await this.database.preferences.get(`editor:${value.project.id}`)) await this.database.preferences.put({ key: `editor:${value.project.id}`, value: value.viewPreferences });
    });
  }
  async delete(id: ProjectId, expectedRevision: number): Promise<void> {
    await this.database.transaction('rw', this.database.documents, this.database.preferences, async () => {
      const current = await this.database.documents.get(id);
      if (!current || current.revision !== expectedRevision) throw new RevisionConflict();
      await this.database.documents.delete(id);
      await this.database.preferences.delete(`editor:${id}`);
    });
  }
  async preferences(): Promise<WorkspacePreferences> { return workspacePreferencesSchema.parse((await this.database.preferences.get('workspace'))?.value ?? defaultPreferences); }
  async savePreferences(preferences: WorkspacePreferences): Promise<void> { await this.database.preferences.put({ key: 'workspace', value: workspacePreferencesSchema.parse(preferences) }); }
  async views(): Promise<Readonly<Record<string, ViewPreferences>>> {
    const rows = await this.database.preferences.where('key').startsWith('editor:').toArray();
    const views: Record<string, ViewPreferences> = {};
    for (const row of rows) {
      const value = viewPreferencesSchema.parse(row.value);
      if (row.key !== `editor:${value.projectId}`) throw new Error('Повреждены настройки вида проекта.');
      views[value.projectId] = value;
    }
    return views;
  }
  async saveView(id: ProjectId, view: ViewPreferences): Promise<void> {
    const value = viewPreferencesSchema.parse(view);
    if (value.projectId !== id) throw new Error('Вид принадлежит другому проекту.');
    await this.database.transaction('rw', this.database.documents, this.database.preferences, async () => {
      if (await this.database.documents.get(id)) await this.database.preferences.put({ key: `editor:${id}`, value });
    });
  }
  async insertBatch(documents: readonly ProjectDocument[], preferences?: WorkspacePreferences): Promise<void> {
    const values = documents.map((document) => projectDocumentSchema.parse(document));
    const prefs = preferences ? workspacePreferencesSchema.parse(preferences) : undefined;
    await this.database.transaction('rw', this.database.documents, this.database.preferences, async () => {
      const seen = new Set((await this.database.documents.toArray()).flatMap((row) => scopedIds(parsed(row))));
      for (const value of values) {
        for (const id of scopedIds(value)) { if (seen.has(id)) throw new Error('ID уже существуют. Импортируйте как копии.'); seen.add(id); }
        await this.database.documents.add(record(value));
        await this.database.preferences.put({ key: `editor:${value.project.id}`, value: value.viewPreferences });
      }
      if (prefs) await this.database.preferences.put({ key: 'workspace', value: prefs });
    });
  }
}
