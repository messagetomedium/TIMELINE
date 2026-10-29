import { z } from 'zod';
import { containsInterval, dateOnly, isDateOnly, overlaps } from './dates';
import {
  assignmentIdSchema, laneIdSchema, personIdSchema, processIdSchema,
  projectIdSchema, stageMarkerIdSchema, stageBandIdSchema, taskIdSchema,
} from './ids';

export const SCHEMA_VERSION = 1;
export const dateOnlySchema = z.string().refine(isDateOnly, 'Expected a real YYYY-MM-DD date').transform(dateOnly);
const text = z.string().trim().min(1);
const index = z.number().int().nonnegative();
const revision = z.number().int().nonnegative();
const timestamp = z.iso.datetime({ offset: true });
const dates = { startDate: dateOnlySchema, endDateExclusive: dateOnlySchema };
const validInterval = (value: { startDate: string; endDateExclusive: string }) => value.startDate < value.endDateExclusive;
const intervalError = { message: 'Interval must contain at least one calendar day', path: ['endDateExclusive'] };

export const statusSchema = z.enum(['Не начато', 'В работе', 'Согласование', 'Пауза', 'Готово', 'Закрыта']);
export const gridStepSchema = z.enum(['1d', '2d', '3d', '1w', '2w', '1mo']);

export const projectSchema = z.strictObject({
  id: projectIdSchema,
  name: text,
  description: z.string().optional(),
  anchorDate: dateOnlySchema,
  ...dates,
  sortIndex: index,
  createdAt: timestamp,
  updatedAt: timestamp,
  revision,
}).refine(validInterval, intervalError).readonly();

export const stageMarkerSchema = z.strictObject({
  id: stageMarkerIdSchema, projectId: projectIdSchema, title: text, date: dateOnlySchema, sortIndex: index,
}).readonly();

/** Neighbouring visual regions share marker IDs; stages never own processes. */
export const stageBandSchema = z.strictObject({
  id: stageBandIdSchema, projectId: projectIdSchema, title: text,
  leftBoundaryId: stageMarkerIdSchema, rightBoundaryId: stageMarkerIdSchema, sortIndex: index,
}).readonly();

export const laneSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: laneIdSchema, projectId: projectIdSchema, sortIndex: index, kind: z.literal('process'), processId: z.null() }),
  z.strictObject({ id: laneIdSchema, projectId: projectIdSchema, sortIndex: index, kind: z.literal('task'), processId: processIdSchema }),
]).readonly();

export const processSchema = z.strictObject({
  id: processIdSchema, projectId: projectIdSchema, laneId: laneIdSchema, title: text,
  ...dates,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  status: statusSchema,
  details: z.string().optional(), sortIndex: index, revision,
}).refine(validInterval, intervalError).readonly();

export const taskSchema = z.strictObject({
  id: taskIdSchema, processId: processIdSchema, laneId: laneIdSchema, title: text,
  ...dates,
  status: statusSchema,
  details: z.string().optional(), sortIndex: index, revision,
}).refine(validInterval, intervalError).readonly();

export const personSchema = z.strictObject({
  id: personIdSchema, displayName: text.optional(), defaultRole: text.optional(), createdAt: timestamp, updatedAt: timestamp,
}).readonly();

const assignmentFields = {
  id: assignmentIdSchema, projectId: projectIdSchema, personId: personIdSchema.optional(),
  roleLabel: text, isLead: z.boolean(), sortIndex: index,
};
export const assignmentSchema = z.discriminatedUnion('targetType', [
  z.strictObject({ ...assignmentFields, targetType: z.literal('process'), targetId: processIdSchema }),
  z.strictObject({ ...assignmentFields, targetType: z.literal('task'), targetId: taskIdSchema }),
]).readonly();

export const viewPreferencesSchema = z.strictObject({
  projectId: projectIdSchema, gridStep: gridStepSchema,
  zoomPxPerDay: z.number().positive(), cameraX: z.number(), cameraY: z.number(),
  showWeekends: z.boolean(),
  expandedProcessIds: z.array(processIdSchema).readonly(),
  expandedAssigneeGroupIds: z.array(assignmentIdSchema).readonly(),
  showPeoplePanel: z.boolean(),
}).readonly();

/** A versioned project aggregate. No UI, database, browser, or sync dependencies. */
export const projectDocumentSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  project: projectSchema,
  stageMarkers: z.array(stageMarkerSchema).readonly(),
  stageBands: z.array(stageBandSchema).default([]).readonly(),
  lanes: z.array(laneSchema).readonly(),
  processes: z.array(processSchema).readonly(),
  tasks: z.array(taskSchema).readonly(),
  people: z.array(personSchema).readonly(),
  assignments: z.array(assignmentSchema).readonly(),
  viewPreferences: viewPreferencesSchema,
}).superRefine((document, context) => {
  const issue = (path: (string | number)[], message: string) => { context.addIssue({ code: 'custom', path, message }); };
  const ids = new Set<string>();
  ids.add(document.project.id);
  for (const key of ['stageMarkers', 'stageBands', 'lanes', 'processes', 'tasks', 'people', 'assignments'] as const) {
    document[key].forEach((entity, position) => {
      if (ids.has(entity.id)) issue([key, position, 'id'], 'Duplicate stable ID');
      ids.add(entity.id);
      if ('projectId' in entity && entity.projectId !== document.project.id) {
        issue([key, position, 'projectId'], 'Entity belongs to a different project');
      }
    });
  }
  const lanes = new Map(document.lanes.map((entity) => [entity.id, entity]));
  const processes: ReadonlyMap<string, Process> = new Map(document.processes.map((entity) => [entity.id, entity]));
  const tasks = new Map(document.tasks.map((entity) => [entity.id, entity]));
  const people = new Set(document.people.map((entity) => entity.id));
  const assignments: ReadonlySet<string> = new Set(document.assignments.map((entity) => entity.id));
  const markers = new Map(document.stageMarkers.map((entity) => [entity.id, entity]));
  document.stageBands.forEach((band, position) => {
    const left = markers.get(band.leftBoundaryId);
    const right = markers.get(band.rightBoundaryId);
    if (!left || !right || left.date >= right.date) issue(['stageBands', position], 'Stage boundaries must exist and be ordered');
  });

  document.lanes.forEach((lane, position) => {
    if (lane.kind === 'task' && !processes.has(lane.processId)) issue(['lanes', position, 'processId'], 'Unknown lane process');
  });
  document.processes.forEach((process, position) => {
    const lane = lanes.get(process.laneId);
    if (lane?.kind !== 'process') issue(['processes', position, 'laneId'], 'Process requires a top-level process lane');
  });
  document.tasks.forEach((task, position) => {
    const process = processes.get(task.processId);
    const lane = lanes.get(task.laneId);
    if (!process) issue(['tasks', position, 'processId'], 'Unknown task process');
    if (lane?.kind !== 'task' || lane.processId !== task.processId) {
      issue(['tasks', position, 'laneId'], 'Task lane must belong to its process');
    }
    if (process && !containsInterval(process, task)) issue(['tasks', position, 'endDateExclusive'], 'Task must fit inside its process');
  });
  document.assignments.forEach((assignment, position) => {
    const targetExists = assignment.targetType === 'process' ? processes.has(assignment.targetId) : tasks.has(assignment.targetId);
    if (!targetExists) issue(['assignments', position, 'targetId'], 'Unknown assignment target');
    if (assignment.personId && !people.has(assignment.personId)) issue(['assignments', position, 'personId'], 'Unknown person');
  });
  if (document.viewPreferences.projectId !== document.project.id) issue(['viewPreferences', 'projectId'], 'View belongs to a different project');
  for (const key of ['expandedProcessIds', 'expandedAssigneeGroupIds'] as const) {
    const seen = new Set<string>();
    document.viewPreferences[key].forEach((id, position) => {
      const known = key === 'expandedProcessIds' ? processes.has(id) : assignments.has(id);
      if (!known || seen.has(id)) issue(['viewPreferences', key, position], 'Unknown or duplicate expansion ID');
      seen.add(id);
    });
  }
  // Adjacent bars are valid: [a,b) and [b,c) do not overlap. Never repack lanes.
  for (const key of ['processes', 'tasks'] as const) {
    const byLane = new Map<string, { entity: Process | Task; position: number }[]>();
    document[key].forEach((entity, position) => {
      const items = byLane.get(entity.laneId) ?? [];
      items.push({ entity, position });
      byLane.set(entity.laneId, items);
    });
    for (const items of byLane.values()) {
      items.sort((a, b) => a.entity.startDate.localeCompare(b.entity.startDate));
      let previous: Process | Task | undefined;
      for (const { entity, position } of items) {
        if (previous && overlaps(previous, entity)) issue([key, position, 'laneId'], 'Intervals overlap in the same lane');
        if (!previous || entity.endDateExclusive > previous.endDateExclusive) previous = entity;
      }
    }
  }
}).readonly();

export type Project = z.infer<typeof projectSchema>;
export type StageMarker = z.infer<typeof stageMarkerSchema>;
export type StageBand = z.infer<typeof stageBandSchema>;
export type GridStep = z.infer<typeof gridStepSchema>;
export type Lane = z.infer<typeof laneSchema>;
export type Process = z.infer<typeof processSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Person = z.infer<typeof personSchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
export type ViewPreferences = z.infer<typeof viewPreferencesSchema>;
export type ProjectDocument = z.infer<typeof projectDocumentSchema>;
