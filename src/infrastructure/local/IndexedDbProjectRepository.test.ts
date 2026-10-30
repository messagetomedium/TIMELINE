import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceDatabase, IndexedDbProjectRepository } from './IndexedDbProjectRepository';
import { productionDemo } from '../demo/production';
import { WorkspaceService } from '../../application/workspace/WorkspaceService';
import { createEmptyProject } from '../../application/workspace/projectOperations';
import { backupSchema, defaultPreferences, RevisionConflict } from '../../application/workspace/model';
import { dateOnly } from '../../domain';

let repository: IndexedDbProjectRepository;
let service: WorkspaceService;
const stamp = '2026-10-30T12:00:00.000Z';
beforeEach(() => { repository = new IndexedDbProjectRepository(new WorkspaceDatabase(`timeline-test-${crypto.randomUUID()}`)); service = new WorkspaceService(repository, productionDemo, { id: () => crypto.randomUUID(), now: () => stamp }); });
afterEach(async () => { await repository.database.delete(); });

describe('Dexie transactions and initialization', () => {
  it('seeds only once and does not resurrect a deleted last project', async () => {
    await Promise.all([service.start(), service.start()]);
    expect(await repository.list()).toHaveLength(1);
    await repository.delete(productionDemo.project.id, 0);
    await service.start();
    expect(await repository.list()).toHaveLength(0);
    expect((await repository.database.metadata.get('initialized'))?.value).toBe(true);
  });
  it('never overwrites documents if initialization metadata was absent', async () => {
    const empty = createEmptyProject({ name: 'Существующий', description: '', startDate: dateOnly('2026-11-02'), endDateExclusive: dateOnly('2026-12-01') }, { id: () => crypto.randomUUID(), now: () => stamp }, 0);
    await repository.save(empty, null);
    await service.start();
    expect((await repository.list()).map((x) => x.name)).toEqual(['Существующий']);
  });
  it('round-trips projects and preferences across a closed/reopened connection', async () => {
    await service.start();
    const preferences = { ...defaultPreferences, mode: 'timeline' as const, portfolio: { camera: { originDate: dateOnly('2026-10-01'), pxPerDay: 21, panX: -400 }, step: '2w' as const, showWeekends: false } };
    await repository.savePreferences(preferences);
    const name = repository.database.name;
    repository.database.close();
    repository = new IndexedDbProjectRepository(new WorkspaceDatabase(name));
    expect(await repository.load(productionDemo.project.id)).toEqual(productionDemo);
    expect(await repository.preferences()).toEqual(preferences);
  });
  it('checks creation and expected revisions inside the same atomic write', async () => {
    await service.start();
    await expect(repository.save(productionDemo, null)).rejects.toBeInstanceOf(RevisionConflict);
    const first = { ...productionDemo, project: { ...productionDemo.project, name: 'Первый', revision: 1 } };
    const second = { ...productionDemo, project: { ...productionDemo.project, name: 'Второй', revision: 1 } };
    const results = await Promise.allSettled([repository.save(first, 0), repository.save(second, 0)]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await repository.load(productionDemo.project.id))?.project.revision).toBe(1);
    await expect(repository.delete(productionDemo.project.id, 0)).rejects.toBeInstanceOf(RevisionConflict);
    expect(await repository.list()).toHaveLength(1);
  });
  it('rolls back a whole import if a later document collides', async () => {
    await service.start();
    const empty = createEmptyProject({ name: 'Не должна остаться', description: '', startDate: dateOnly('2026-11-02'), endDateExclusive: dateOnly('2026-12-01') }, { id: () => crypto.randomUUID(), now: () => stamp }, 1);
    await expect(repository.insertBatch([empty, productionDemo], { ...defaultPreferences, mode: 'timeline' })).rejects.toThrow('ID уже существуют');
    expect(await repository.list()).toHaveLength(1);
    expect(await repository.load(empty.project.id)).toBeNull();
    expect((await repository.preferences()).mode).toBe('cards');
  });
  it('refuses unsupported schema versions without resetting documents or metadata', async () => {
    await service.start();
    await repository.database.metadata.put({ key: 'schemaVersion', value: 2 });
    await expect(service.start()).rejects.toThrow('не поддерживается');
    expect(await repository.list()).toHaveLength(1);
    expect((await repository.database.metadata.get('schemaVersion'))?.value).toBe(2);
  });
});

describe('workspace service, persistence and backups', () => {
  it('stores a blank project and real work; deep copy edits never affect the original', async () => {
    await service.start();
    const id = await service.create({ name: 'Проект Б', description: '', startDate: dateOnly('2026-11-02'), endDateExclusive: dateOnly('2026-12-01') });
    expect((await repository.load(id))?.tasks).toEqual([]);
    await service.createWork(id, 'process', { title: 'Процесс', startDate: dateOnly('2026-11-02'), endDateExclusive: dateOnly('2026-11-10'), laneId: null }, null);
    const source = await repository.load(id);
    const parent = source?.processes[0];
    if (!parent) throw new Error('Missing process');
    await service.createWork(id, 'task', { title: 'Задача', startDate: dateOnly('2026-11-02'), endDateExclusive: dateOnly('2026-11-05'), laneId: null }, parent.id);
    const before = await repository.load(id);
    const copy = await service.duplicate(id);
    await service.rename(copy, 'Независимая копия', 'Описание', 0);
    expect(await repository.load(id)).toEqual(before);
    expect((await repository.load(copy))?.tasks).toHaveLength(1);
    expect((await repository.load(copy))?.project.updatedAt).toBe(stamp);
  });
  it('shifts only one complete aggregate, timestamps commit, and rejects stale revisions', async () => {
    await service.start();
    const copyId = await service.duplicate(productionDemo.project.id);
    await service.shift(copyId, 7, 0);
    const shifted = await repository.load(copyId);
    expect(shifted?.project.startDate).toBe('2026-09-08');
    expect(shifted?.tasks[0]?.startDate).toBe('2026-09-16');
    expect(shifted?.project.updatedAt).toBe(stamp);
    expect(await repository.load(productionDemo.project.id)).toEqual(productionDemo);
    await expect(service.shift(copyId, 7, 0)).rejects.toBeInstanceOf(RevisionConflict);
    expect(await repository.load(copyId)).toEqual(shifted);
  });
  it('stores editor view separately without changing schedule revisions; clone and export retain it', async () => {
    await service.start();
    const view = { ...productionDemo.viewPreferences, zoomPxPerDay: 22, cameraX: -500, gridStep: '2w' as const };
    await service.saveView(productionDemo.project.id, view);
    expect((await repository.load(productionDemo.project.id))?.project.revision).toBe(0);
    const copy = await service.duplicate(productionDemo.project.id);
    expect((await repository.load(copy))?.viewPreferences.zoomPxPerDay).toBe(22);
    const backup = backupSchema.parse(JSON.parse(await service.exportBackup()));
    expect(backup.documents[0]?.viewPreferences.cameraX).toBe(-500);
    expect(backup.documents).toHaveLength(2);
  });
  it('validates import before writing, previews collisions and imports copies atomically', async () => {
    await service.start();
    await expect(service.previewImport('{')).rejects.toThrow('не является JSON');
    await expect(service.previewImport('{"version":99}')).rejects.toThrow('не прошла проверку');
    const preview = await service.previewImport(await service.exportBackup());
    expect(preview.collisions).toBe(1);
    await expect(service.importBackup(preview.backup, false)).rejects.toThrow('ID уже существуют');
    expect(await repository.list()).toHaveLength(1);
    await service.importBackup(preview.backup, true);
    expect(await repository.list()).toHaveLength(2);
    expect(await repository.load(productionDemo.project.id)).toEqual(productionDemo);
    expect((await repository.all())[1]?.people.map((x) => x.id)).toEqual(productionDemo.people.map((x) => x.id));
  });
});
