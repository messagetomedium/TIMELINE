import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { demoProject } from '../infrastructure/demo/project';
import type { DateOnly } from './dates';
import { assignmentIdSchema, processIdSchema, projectIdSchema, taskIdSchema } from './ids';
import type { ProcessId, ProjectId, TaskId } from './ids';
import { assignmentSchema, dateOnlySchema, gridStepSchema, laneSchema, projectDocumentSchema, projectSchema, statusSchema, viewPreferencesSchema } from './schema';
import type { Assignment, Lane } from './schema';

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[] : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;

function rawDemo(): Mutable<z.input<typeof projectDocumentSchema>> {
  return JSON.parse(JSON.stringify(demoProject)) as Mutable<z.input<typeof projectDocumentSchema>>;
}

function first<T>(values: readonly T[], position = 0): T {
  const value = values[position];
  if (!value) throw new Error('Missing fixture entry');
  return value;
}

function rejects(mutate: (document: ReturnType<typeof rawDemo>) => void, path: string) {
  const document = rawDemo();
  mutate(document);
  const result = projectDocumentSchema.safeParse(document);
  expect(result.success).toBe(false);
  if (result.success) throw new Error('Invalid document was accepted');
  expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(path);
}

describe('stable IDs and static schema types', () => {
  it('brands each entity ID and calendar date distinctly at compile time', () => {
    expectTypeOf<ProjectId>().not.toEqualTypeOf<TaskId>();
    expectTypeOf<ProcessId>().not.toEqualTypeOf<ProjectId>();
    expectTypeOf<string>().not.toExtend<DateOnly>();
    expectTypeOf<Extract<Assignment, { targetType: 'task' }>['targetId']>().toEqualTypeOf<TaskId>();
    expectTypeOf<Extract<Lane, { kind: 'process' }>['processId']>().toEqualTypeOf<null>();
    expectTypeOf<Extract<Lane, { kind: 'task' }>['processId']>().toEqualTypeOf<ProcessId>();
    // These assertions must fail compilation if brands are ever weakened.
    // @ts-expect-error IDs from separate entities must not be interchangeable.
    const projectId: ProjectId = taskIdSchema.parse('50000000-0000-4000-8000-000000000001');
    expect(projectId).toBeDefined();
    // @ts-expect-error Raw strings must be parsed before becoming scheduling dates.
    const date: DateOnly = '2026-10-01';
    expect(date).toBeDefined();
  });
  it('round-trips UUIDs and normalizes case without using indices', () => {
    const input = 'ABCDEFAB-1234-4ABC-8ABC-ABCDEFABCDEF';
    expect(projectIdSchema.parse(input)).toBe(input.toLowerCase());
    expect(projectIdSchema.parse(JSON.parse(JSON.stringify(demoProject.project.id)))).toBe(demoProject.project.id);
    for (const invalid of ['0', 'project-1', '', '10000000-0000-0000-0000-000000000001']) expect(projectIdSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('entity schemas', () => {
  it('validates a deterministic complete document and JSON round-trip', () => {
    expect(projectDocumentSchema.parse(rawDemo())).toEqual(demoProject);
    expect(Object.isFrozen(demoProject)).toBe(true);
    expect(Object.isFrozen(demoProject.tasks)).toBe(true);
    expect(Object.isFrozen(first(demoProject.tasks))).toBe(true);
  });
  it('accepts an explicitly bounded blank project without demo content', () => {
    const document = rawDemo();
    document.stageMarkers = []; document.processes = []; document.tasks = [];
    document.people = []; document.assignments = [];
    document.lanes = [first(document.lanes)];
    expect(projectDocumentSchema.parse(document).tasks).toEqual([]);
  });
  it.each(['Не начато', 'В работе', 'Согласование', 'Пауза', 'Готово', 'Закрыта'])('supports status %s', (status) => {
    expect(statusSchema.parse(status)).toBe(status);
  });
  it('rejects dates that JavaScript would normalize and invalid intervals', () => {
    expect(dateOnlySchema.safeParse('2026-02-30').success).toBe(false);
    expect(projectSchema.safeParse({ ...demoProject.project, endDateExclusive: demoProject.project.startDate }).success).toBe(false);
    expect(projectSchema.safeParse({ ...demoProject.project, startDate: '2027-01-01' }).success).toBe(false);
  });
  it('keeps stages as dated markers, rejecting interval/container fields', () => {
    const document = rawDemo();
    expect(projectDocumentSchema.safeParse({ ...document, stageMarkers: [{ ...first(document.stageMarkers), startDate: '2026-10-01' }] }).success).toBe(false);
  });
  it('discriminates task lanes from top-level process lanes', () => {
    expect(laneSchema.safeParse({ ...first(demoProject.lanes), processId: first(demoProject.processes).id }).success).toBe(false);
    expect(laneSchema.safeParse({ ...first(demoProject.lanes, 1), processId: null }).success).toBe(false);
  });
  it('supports multiple assignees and a role without a named person', () => {
    const document = rawDemo();
    document.assignments.push({ ...first(document.assignments, 1), id: '70000000-0000-4000-8000-000000000003', personId: first(document.people).id });
    expect(projectDocumentSchema.parse(document).assignments).toHaveLength(3);
    expect(assignmentSchema.parse(first(document.assignments, 1)).personId).toBeUndefined();
  });
  it('keeps zoom and snap step independent and rejects invalid view values', () => {
    const preferences = demoProject.viewPreferences;
    expect(viewPreferencesSchema.parse({ ...preferences, gridStep: '1mo' }).zoomPxPerDay).toBe(preferences.zoomPxPerDay);
    expect(viewPreferencesSchema.parse({ ...preferences, zoomPxPerDay: 48 }).gridStep).toBe(preferences.gridStep);
    for (const step of ['1d', '2d', '3d', '1w', '2w', '1mo']) expect(gridStepSchema.safeParse(step).success).toBe(true);
    expect(viewPreferencesSchema.safeParse({ ...preferences, zoomPxPerDay: 0 }).success).toBe(false);
    expect(viewPreferencesSchema.safeParse({ ...preferences, cameraX: Infinity }).success).toBe(false);
    expect(statusSchema.safeParse('50%').success).toBe(false);
  });
  it('rejects unknown schema versions, unknown fields and negative revisions', () => {
    expect(projectDocumentSchema.safeParse({ ...rawDemo(), schemaVersion: 2 }).success).toBe(false);
    expect(projectSchema.safeParse({ ...demoProject.project, syncStatus: 'synced' }).success).toBe(false);
    expect(projectSchema.safeParse({ ...demoProject.project, revision: -1 }).success).toBe(false);
  });
});

describe('aggregate references and scheduling invariants', () => {
  it('rejects duplicate UUIDs', () => {
    rejects((document) => { document.tasks.push(first(document.tasks)); }, 'tasks.3.id');
  });
  it('rejects foreign project ownership', () => {
    rejects((document) => { first(document.processes).projectId = '10000000-0000-4000-8000-000000000099'; }, 'processes.0.projectId');
  });
  it('rejects orphan task processes and task lanes', () => {
    rejects((document) => { first(document.tasks).processId = '40000000-0000-4000-8000-000000000099'; }, 'tasks.0.processId');
    rejects((document) => { first(document.lanes, 1).processId = '40000000-0000-4000-8000-000000000099'; }, 'lanes.1.processId');
  });
  it('rejects the wrong process lane or a task in another process lane', () => {
    rejects((document) => { first(document.processes).laneId = first(document.lanes, 1).id; }, 'processes.0.laneId');
    rejects((document) => { first(document.tasks).laneId = first(document.lanes, 2).id; }, 'tasks.0.laneId');
    rejects((document) => { first(document.tasks).laneId = '30000000-0000-4000-8000-000000000099'; }, 'tasks.0.laneId');
  });
  it('rejects a child outside either process boundary', () => {
    rejects((document) => { first(document.tasks).startDate = '2026-09-30'; }, 'tasks.0.endDateExclusive');
    rejects((document) => { first(document.tasks).endDateExclusive = '2026-10-11'; }, 'tasks.0.endDateExclusive');
  });
  it('accepts matching boundaries and adjacent tasks in a shared lane', () => {
    const document = rawDemo();
    first(document.tasks).endDateExclusive = first(document.processes).endDateExclusive;
    expect(projectDocumentSchema.safeParse(document).success).toBe(true);
  });
  it('rejects overlapping tasks and processes on a shared lane', () => {
    rejects((document) => { first(document.tasks, 2).startDate = '2026-10-16'; }, 'tasks.2.laneId');
    rejects((document) => { first(document.processes).endDateExclusive = '2026-10-11'; }, 'processes.1.laneId');
  });
  it('allows parallel tasks on separate explicit lanes', () => {
    const document = rawDemo();
    const parallelLane = { ...first(document.lanes, 2), id: '30000000-0000-4000-8000-000000000004' };
    document.lanes.push(parallelLane);
    first(document.tasks, 2).laneId = parallelLane.id;
    first(document.tasks, 2).startDate = '2026-10-10';
    expect(projectDocumentSchema.safeParse(document).success).toBe(true);
  });
  it('rejects missing assignment targets and people', () => {
    rejects((document) => { first(document.assignments).targetId = processIdSchema.parse('40000000-0000-4000-8000-000000000099'); }, 'assignments.0.targetId');
    rejects((document) => { first(document.assignments).personId = '60000000-0000-4000-8000-000000000099'; }, 'assignments.0.personId');
  });
  it('validates project-owned expansion state, including duplicates', () => {
    const document = rawDemo();
    document.viewPreferences.expandedProcessIds = [first(document.processes).id];
    document.viewPreferences.expandedAssigneeGroupIds = [assignmentIdSchema.parse(first(document.assignments).id)];
    expect(projectDocumentSchema.safeParse(document).success).toBe(true);
    rejects((draft) => { draft.viewPreferences.projectId = '10000000-0000-4000-8000-000000000099'; }, 'viewPreferences.projectId');
    rejects((draft) => { draft.viewPreferences.expandedProcessIds = ['40000000-0000-4000-8000-000000000099']; }, 'viewPreferences.expandedProcessIds.0');
    rejects((draft) => { draft.viewPreferences.expandedProcessIds = [first(draft.processes).id, first(draft.processes).id]; }, 'viewPreferences.expandedProcessIds.1');
  });
});
