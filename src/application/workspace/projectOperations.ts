import {
  addDays, interval, laneIdSchema, processIdSchema, projectDocumentSchema, projectIdSchema, shiftInterval, taskIdSchema,
} from '../../domain';
import type { DateInterval, ProjectDocument, ProcessId } from '../../domain';

export interface OperationDependencies { readonly id: () => string; readonly now: () => string }
export interface ProjectInput extends DateInterval { readonly name: string; readonly description: string }
export interface WorkInput extends DateInterval { readonly title: string; readonly laneId: string | null }

export function createEmptyProject(input: ProjectInput, dependencies: OperationDependencies, sortIndex: number): ProjectDocument {
  const id = projectIdSchema.parse(dependencies.id());
  const now = dependencies.now();
  return projectDocumentSchema.parse({
    schemaVersion: 1,
    project: { id, name: input.name, description: input.description, anchorDate: input.startDate, ...interval(input.startDate, input.endDateExclusive), sortIndex, createdAt: now, updatedAt: now, revision: 0 },
    stageMarkers: [], stageBands: [], processes: [], tasks: [], people: [], assignments: [],
    lanes: [{ id: dependencies.id(), projectId: id, kind: 'process', processId: null, sortIndex: 0 }],
    viewPreferences: { projectId: id, gridStep: '1w', zoomPxPerDay: 14, cameraX: 24, cameraY: 0, showWeekends: true, expandedProcessIds: [], expandedAssigneeGroupIds: [], showPeoplePanel: true },
  });
}

/** Pure: one calendar delta, each entity once, timestamps stamped by the service. */
export function shiftProject(document: ProjectDocument, days: number): ProjectDocument {
  return projectDocumentSchema.parse({
    ...document,
    project: { ...document.project, ...shiftInterval(document.project, days), anchorDate: addDays(document.project.anchorDate, days), revision: document.project.revision + 1 },
    stageMarkers: document.stageMarkers.map((stage) => ({ ...stage, date: addDays(stage.date, days) })),
    processes: document.processes.map((process) => ({ ...process, ...shiftInterval(process, days), revision: process.revision + 1 })),
    tasks: document.tasks.map((task) => ({ ...task, ...shiftInterval(task, days), revision: task.revision + 1 })),
  });
}

export function cloneProject(source: ProjectDocument, dependencies: OperationDependencies, sortIndex: number): ProjectDocument {
  const map = new Map<string, string>();
  const fresh = (old: string) => { const value = dependencies.id(); map.set(old, value); return value; };
  const mapped = (old: string) => { const value = map.get(old); if (!value) throw new Error('Не удалось скопировать связь.'); return value; };
  const projectId = fresh(source.project.id);
  for (const key of ['stageMarkers', 'stageBands', 'lanes', 'processes', 'tasks', 'assignments'] as const) source[key].forEach((item) => fresh(item.id));
  const now = dependencies.now();
  return projectDocumentSchema.parse({
    ...source,
    project: { ...source.project, id: projectId, name: `${source.project.name} — копия`, sortIndex, createdAt: now, updatedAt: now, revision: 0 },
    stageMarkers: source.stageMarkers.map((item) => ({ ...item, id: mapped(item.id), projectId })),
    stageBands: source.stageBands.map((item) => ({ ...item, id: mapped(item.id), projectId, leftBoundaryId: mapped(item.leftBoundaryId), rightBoundaryId: mapped(item.rightBoundaryId) })),
    lanes: source.lanes.map((item) => ({ ...item, id: mapped(item.id), projectId, processId: item.kind === 'task' ? mapped(item.processId) : null })),
    processes: source.processes.map((item) => ({ ...item, id: mapped(item.id), projectId, laneId: mapped(item.laneId), revision: 0 })),
    tasks: source.tasks.map((item) => ({ ...item, id: mapped(item.id), processId: mapped(item.processId), laneId: mapped(item.laneId), revision: 0 })),
    assignments: source.assignments.map((item) => ({ ...item, id: mapped(item.id), projectId, targetId: mapped(item.targetId) })),
    people: source.people.map((person) => ({ ...person })),
    viewPreferences: { ...source.viewPreferences, projectId, expandedProcessIds: source.viewPreferences.expandedProcessIds.map(mapped), expandedAssigneeGroupIds: source.viewPreferences.expandedAssigneeGroupIds.map(mapped) },
  });
}

export function addWork(document: ProjectDocument, kind: 'process' | 'task', input: WorkInput, dependencies: OperationDependencies, parentId: ProcessId | null = null): ProjectDocument {
  const dates = interval(input.startDate, input.endDateExclusive);
  const laneId = input.laneId ? laneIdSchema.parse(input.laneId) : laneIdSchema.parse(dependencies.id());
  const lanes = [...document.lanes];
  if (!input.laneId) lanes.push(kind === 'process'
    ? { id: laneId, projectId: document.project.id, kind: 'process', processId: null, sortIndex: lanes.length }
    : { id: laneId, projectId: document.project.id, kind: 'task', processId: processIdSchema.parse(parentId), sortIndex: lanes.length });
  let processes = [...document.processes];
  const tasks = [...document.tasks];
  const expanded = [...document.viewPreferences.expandedProcessIds];
  if (kind === 'process') {
    const id = processIdSchema.parse(dependencies.id());
    processes.push({ id, projectId: document.project.id, laneId, title: input.title, ...dates, color: '#8d80ca', status: 'Не начато', sortIndex: processes.length, revision: 0 });
    expanded.push(id);
  } else {
    const parent = processes.find((process) => process.id === parentId);
    if (!parent) throw new Error('Выберите родительский процесс.');
    tasks.push({ id: taskIdSchema.parse(dependencies.id()), processId: parent.id, laneId, title: input.title, ...dates, status: 'Не начато', sortIndex: tasks.length, revision: 0 });
    processes = processes.map((process) => process.id !== parent.id ? process : { ...process, startDate: dates.startDate < process.startDate ? dates.startDate : process.startDate, endDateExclusive: dates.endDateExclusive > process.endDateExclusive ? dates.endDateExclusive : process.endDateExclusive, revision: process.revision + 1 });
    if (!expanded.includes(parent.id)) expanded.push(parent.id);
  }
  const parsed = projectDocumentSchema.safeParse({ ...document, lanes, processes, tasks, project: { ...document.project, revision: document.project.revision + 1 }, viewPreferences: { ...document.viewPreferences, expandedProcessIds: expanded } });
  if (!parsed.success) throw new Error('Проверьте даты и дорожку: работы одной дорожки не должны пересекаться.');
  return parsed.data;
}
