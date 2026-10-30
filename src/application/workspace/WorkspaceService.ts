import { projectDocumentSchema } from '../../domain';
import type { ProcessId, ProjectDocument, ProjectId, ViewPreferences } from '../../domain';
import { backupSchema, RevisionConflict, scopedIds } from './model';
import type { Backup, WorkspacePreferences, WorkspaceRepository } from './model';
import { addWork, cloneProject, createEmptyProject, shiftProject } from './projectOperations';
import type { OperationDependencies, ProjectInput, WorkInput } from './projectOperations';

export class WorkspaceService {
  readonly repository: WorkspaceRepository;
  private readonly seed: ProjectDocument;
  private readonly dependencies: OperationDependencies;
  constructor(repository: WorkspaceRepository, seed: ProjectDocument, dependencies: OperationDependencies = { id: () => crypto.randomUUID(), now: () => new Date().toISOString() }) {
    this.repository = repository; this.seed = seed; this.dependencies = dependencies;
  }
  async start() { await this.repository.initialize(this.seed); return this.snapshot(); }
  async snapshot() {
    const [documents, preferences, views] = await Promise.all([this.repository.all(), this.repository.preferences(), this.repository.views()]);
    return { documents, preferences, views };
  }
  private async document(id: ProjectId, revision?: number) {
    const value = await this.repository.load(id);
    if (!value) throw new RevisionConflict();
    if (revision !== undefined && value.project.revision !== revision) throw new RevisionConflict();
    return value;
  }
  private async nextIndex() { return (await this.repository.list()).reduce((max, project) => Math.max(max, project.sortIndex + 1), 0); }
  async create(input: ProjectInput): Promise<ProjectId> {
    if (!input.name.trim()) throw new Error('Укажите название проекта.');
    const document = createEmptyProject(input, this.dependencies, await this.nextIndex());
    await this.repository.save(document, null);
    return document.project.id;
  }
  async duplicate(id: ProjectId): Promise<ProjectId> {
    const document = cloneProject(await this.document(id), this.dependencies, await this.nextIndex());
    await this.repository.insertBatch([document]);
    return document.project.id;
  }
  async rename(id: ProjectId, name: string, description: string, revision: number) {
    if (!name.trim()) throw new Error('Название проекта не может быть пустым.');
    const source = await this.document(id, revision);
    await this.repository.save(projectDocumentSchema.parse({ ...source, project: { ...source.project, name, description, updatedAt: this.dependencies.now(), revision: revision + 1 } }), revision);
  }
  async remove(id: ProjectId, revision: number) { await this.repository.delete(id, revision); }
  async shift(id: ProjectId, days: number, revision: number) {
    const source = await this.document(id, revision);
    const next = shiftProject(source, days);
    await this.repository.save({ ...next, project: { ...next.project, updatedAt: this.dependencies.now() } }, revision);
  }
  async commit(next: ProjectDocument) {
    const source = await this.document(next.project.id, next.project.revision - 1);
    await this.repository.save(projectDocumentSchema.parse({ ...next, viewPreferences: source.viewPreferences, project: { ...next.project, updatedAt: this.dependencies.now() } }), source.project.revision);
  }
  async createWork(id: ProjectId, kind: 'process' | 'task', input: WorkInput, parentId: ProcessId | null) {
    const source = await this.document(id);
    const next = addWork(source, kind, input, this.dependencies, parentId);
    await this.repository.save({ ...next, project: { ...next.project, updatedAt: this.dependencies.now() } }, source.project.revision);
  }
  async saveView(id: ProjectId, view: ViewPreferences) { await this.repository.saveView(id, view); }
  async savePreferences(preferences: WorkspacePreferences) { await this.repository.savePreferences(preferences); }
  async exportBackup(): Promise<string> {
    const snapshot = await this.snapshot();
    return JSON.stringify(backupSchema.parse({ format: 'timeline-backup', version: 1, exportedAt: this.dependencies.now(), documents: snapshot.documents, preferences: snapshot.preferences }), null, 2);
  }
  async previewImport(text: string): Promise<{ backup: Backup; collisions: number }> {
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new Error('Файл не является JSON.'); }
    const result = backupSchema.safeParse(input);
    if (!result.success) throw new Error('Резервная копия не прошла проверку версии, дат или связей. Ничего не импортировано.');
    const existing = new Set((await this.repository.all()).flatMap(scopedIds));
    return { backup: result.data, collisions: result.data.documents.filter((document) => scopedIds(document).some((id) => existing.has(id))).length };
  }
  async importBackup(backup: Backup, copies: boolean) {
    const parsed = backupSchema.parse(backup);
    const index = await this.nextIndex();
    const documents = copies ? parsed.documents.map((document, position) => cloneProject(document, this.dependencies, index + position)) : parsed.documents;
    await this.repository.insertBatch(documents, parsed.preferences);
  }
}
