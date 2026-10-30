import { describe, expect, it } from 'vitest';
import { addDays, dateOnly, daysBetween, projectDocumentSchema } from '../../domain';
import { productionDemo } from '../../infrastructure/demo/production';
import { addWork, cloneProject, createEmptyProject, shiftProject } from './projectOperations';
import { allProjectsRange, portfolioRange, projectColor } from './portfolio';
import { backupSchema, defaultPreferences, scopedIds } from './model';
import { cameraForFitRange, xForDate } from '../../domain/timeline';

function dependencies() {
  let index = 0;
  return { id: () => `00000090-0000-4000-8000-${String(++index).padStart(12, '0')}`, now: () => '2026-10-30T12:00:00.000Z' };
}
const input = { name: 'Проект Б', description: 'Новая постановка', startDate: dateOnly('2026-11-02'), endDateExclusive: dateOnly('2026-12-01') };

describe('complete project operations', () => {
  it('creates a bounded blank document with one process lane and no demo entities', () => {
    const blank = createEmptyProject(input, dependencies(), 3);
    expect(projectDocumentSchema.parse(blank)).toEqual(blank);
    for (const key of ['processes', 'tasks', 'stageMarkers', 'stageBands', 'assignments', 'people'] as const) expect(blank[key]).toEqual([]);
    expect(blank.lanes).toHaveLength(1);
    expect(blank.project.createdAt).toBe('2026-10-30T12:00:00.000Z');
    expect(blank.project.sortIndex).toBe(3);
    expect(blank.viewPreferences.projectId).toBe(blank.project.id);
  });
  it('deep-clones every scoped ID and relationship while preserving people, dates and layout', () => {
    const source = projectDocumentSchema.parse({ ...productionDemo, viewPreferences: { ...productionDemo.viewPreferences, zoomPxPerDay: 21, cameraX: -412, expandedProcessIds: productionDemo.processes.map((x) => x.id), expandedAssigneeGroupIds: productionDemo.assignments.map((x) => x.id) } });
    const original = JSON.stringify(source);
    const copy = cloneProject(source, dependencies(), 2);
    const old = new Set(scopedIds(source));
    expect(scopedIds(copy).some((id) => old.has(id))).toBe(false);
    for (const key of ['stageMarkers', 'stageBands', 'processes', 'tasks', 'lanes', 'assignments'] as const) expect(copy[key]).toHaveLength(source[key].length);
    expect(copy.people).toEqual(source.people);
    expect(copy.people[0]).not.toBe(source.people[0]);
    expect(copy.tasks[0]).not.toBe(source.tasks[0]);
    expect(copy.assignments.map((x) => x.personId)).toEqual(source.assignments.map((x) => x.personId));
    expect(copy.viewPreferences.expandedProcessIds).toEqual(copy.processes.map((x) => x.id));
    expect(copy.viewPreferences.expandedAssigneeGroupIds).toEqual(copy.assignments.map((x) => x.id));
    expect(copy.viewPreferences.cameraX).toBe(-412);
    expect(copy.project.name).toBe('Сказки Амура — копия');
    expect(copy.project.revision).toBe(0);
    expect(copy.tasks.every((x) => x.revision === 0)).toBe(true);
    expect(JSON.stringify(source)).toBe(original);
    expect(projectDocumentSchema.safeParse(copy).success).toBe(true);
  });
  it.each([7, -7, 31, -365])('shifts all dates exactly %s days, keeping durations and references', (delta) => {
    const source = productionDemo;
    const next = shiftProject(source, delta);
    expect(next.project.anchorDate).toBe(addDays(source.project.anchorDate, delta));
    expect(next.project.startDate).toBe(addDays(source.project.startDate, delta));
    expect(next.project.endDateExclusive).toBe(addDays(source.project.endDateExclusive, delta));
    for (const key of ['processes', 'tasks'] as const) next[key].forEach((item, index) => {
      const before = source[key][index];
      if (!before) throw new Error('Missing source item');
      expect(item.startDate).toBe(addDays(before.startDate, delta));
      expect(item.endDateExclusive).toBe(addDays(before.endDateExclusive, delta));
      expect(daysBetween(item.startDate, item.endDateExclusive)).toBe(daysBetween(before.startDate, before.endDateExclusive));
      expect(item.laneId).toBe(before.laneId);
      expect(item.title).toBe(before.title);
    });
    next.stageMarkers.forEach((marker, index) => { expect(marker.date).toBe(addDays(source.stageMarkers[index]?.date ?? source.project.startDate, delta)); });
    expect(next.stageBands).toEqual(source.stageBands);
    expect(next.assignments).toEqual(source.assignments);
    expect(next.people).toEqual(source.people);
    expect(next.lanes).toEqual(source.lanes);
    expect(next.project.createdAt).toBe(source.project.createdAt);
    expect(next.project.updatedAt).toBe(source.project.updatedAt);
    expect(source.project.revision).toBe(0);
    expect(next.project.revision).toBe(1);
  });
  it('supports a new process and task, explicit lanes and parent growth without repacking', () => {
    const deps = dependencies();
    const blank = createEmptyProject(input, deps, 0);
    const process = addWork(blank, 'process', { title: 'Подготовка', startDate: input.startDate, endDateExclusive: dateOnly('2026-11-10'), laneId: blank.lanes[0]?.id ?? null }, deps);
    const parent = process.processes[0];
    if (!parent) throw new Error('Missing process');
    const task = addWork(process, 'task', { title: 'Концепты', startDate: dateOnly('2026-11-01'), endDateExclusive: dateOnly('2026-11-20'), laneId: null }, deps, parent.id);
    expect(task.processes[0]?.startDate).toBe('2026-11-01');
    expect(task.processes[0]?.endDateExclusive).toBe('2026-11-20');
    expect(task.tasks[0]?.processId).toBe(parent.id);
    expect(task.lanes.filter((x) => x.kind === 'task')).toHaveLength(1);
    expect(process.tasks).toEqual([]);
    const lane = task.tasks[0]?.laneId ?? null;
    expect(() => addWork(task, 'task', { title: 'Конфликт', startDate: input.startDate, endDateExclusive: dateOnly('2026-11-05'), laneId: lane }, deps, parent.id)).toThrow('не должны пересекаться');
    expect(addWork(task, 'task', { title: 'Следом', startDate: dateOnly('2026-11-20'), endDateExclusive: dateOnly('2026-11-22'), laneId: lane }, deps, parent.id).tasks).toHaveLength(2);
  });
  it('rejects invalid input, unknown lanes/parents and calendar overflow', () => {
    expect(() => createEmptyProject({ ...input, endDateExclusive: input.startDate }, dependencies(), 0)).toThrow();
    expect(() => shiftProject(productionDemo, 0.5)).toThrow();
    expect(() => shiftProject(productionDemo, Number.MAX_SAFE_INTEGER)).toThrow();
    const process = productionDemo.processes[0];
    if (!process) throw new Error('Missing process');
    expect(() => addWork(productionDemo, 'task', { title: 'Чужая дорожка', ...input, laneId: productionDemo.lanes[0]?.id ?? null }, dependencies(), process.id)).toThrow();
  });
});

describe('portfolio and backup projection', () => {
  it('includes outside work and stage-marker days, even for an empty portfolio', () => {
    const range = portfolioRange(productionDemo);
    expect(range.startDate).toBe('2026-09-01');
    expect(range.endDateExclusive).toBe('2027-09-02');
    const shifted = shiftProject(productionDemo, 730);
    const all = allProjectsRange([productionDemo, shifted]);
    expect(all?.endDateExclusive).toBe(addDays(range.endDateExclusive, 730));
    expect(allProjectsRange([])).toBeNull();
    if (!all) throw new Error('Missing range');
    const camera = cameraForFitRange({ originDate: range.startDate, pxPerDay: 14, panX: 0 }, all, 1000);
    expect(xForDate(all.startDate, camera)).toBeCloseTo(24);
    expect(xForDate(all.endDateExclusive, camera)).toBeCloseTo(976);
    expect(projectColor(productionDemo.project.id)).toBe(projectColor(productionDemo.project.id));
  });
  it('validates a versioned backup as a whole, rejecting malformed links and duplicate scoped IDs', () => {
    const value = { format: 'timeline-backup', version: 1, exportedAt: '2026-10-30T12:00:00Z', documents: [productionDemo], preferences: defaultPreferences };
    expect(backupSchema.safeParse(value).success).toBe(true);
    expect(backupSchema.safeParse({ ...value, version: 2 }).success).toBe(false);
    expect(backupSchema.safeParse({ ...value, documents: [productionDemo, productionDemo] }).success).toBe(false);
    expect(backupSchema.safeParse({ ...value, documents: [{ ...productionDemo, processes: [] }] }).success).toBe(false);
  });
});
