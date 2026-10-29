import { describe, expect, it } from 'vitest';
import { productionDemo } from '../infrastructure/demo/production';
import { addDays, dateOnly, daysBetween, projectDocumentSchema } from '../domain';
import type { ProjectDocument } from '../domain';
import { applyTimelineCommand } from './timelineCommands';
import type { CommandResult } from './timelineCommands';
import { layoutTimeline } from './timelineLayout';

const process = productionDemo.processes[0];
const task = productionDemo.tasks[0];
if (!process || !task) throw new Error('Missing production fixture');
const processTarget = { kind: 'process', id: process.id } as const;
const taskTarget = { kind: 'task', id: task.id } as const;

function applied(result: CommandResult): ProjectDocument {
  if (!result.ok) throw new Error(result.error);
  return result.document;
}

describe('production fixture and layout', () => {
  it('contains a year, four shared-boundary stages, eight processes and 32 tasks', () => {
    expect(daysBetween(productionDemo.project.startDate, productionDemo.project.endDateExclusive)).toBe(365);
    expect(productionDemo.stageBands).toHaveLength(4);
    expect(productionDemo.processes).toHaveLength(8);
    expect(productionDemo.tasks).toHaveLength(32);
    expect(productionDemo.assignments).toHaveLength(40);
    expect(projectDocumentSchema.parse(productionDemo)).toEqual(productionDemo);
  });
  it('expands independent groups in explicit lane order without mutating data', () => {
    const second = productionDemo.processes[1];
    if (!second) throw new Error('Missing second process');
    const collapsed = layoutTimeline(productionDemo, new Set());
    const expanded = layoutTimeline(productionDemo, new Set([process.id, second.id]));
    expect(collapsed.rows).toHaveLength(8);
    expect(expanded.rows).toHaveLength(14);
    expect(expanded.groups).toHaveLength(2);
    expect(expanded.height).toBeGreaterThan(collapsed.height);
    expect(expanded.rows[0]?.id).toBe(process.laneId);
    expect(expanded.rows.filter((row) => row.processId === process.id).map((row) => row.id)).toEqual(productionDemo.lanes.filter((lane) => lane.kind === 'task' && lane.processId === process.id).map((lane) => lane.id));
  });
  it('rejects crossed or missing stage boundaries', () => {
    expect(projectDocumentSchema.safeParse({ ...productionDemo, stageMarkers: productionDemo.stageMarkers.slice(1) }).success).toBe(false);
    const crossed = { ...productionDemo, stageMarkers: productionDemo.stageMarkers.map((stage, index) => index === 1 ? { ...stage, date: '2026-08-01' } : stage) };
    expect(projectDocumentSchema.safeParse(crossed).success).toBe(false);
  });
});

describe('atomic V1 editing operations', () => {
  it.each([7, -7])('moves a process and each child exactly %s days, preserving markers and lanes', (days) => {
    const after = applied(applyTimelineCommand(productionDemo, { type: 'move', target: processTarget, days }));
    expect(after.processes[0]?.startDate).toBe(addDays(process.startDate, days));
    for (const original of productionDemo.tasks) {
      const changed = after.tasks.find((item) => item.id === original.id);
      expect(changed?.startDate).toBe(original.processId === process.id ? addDays(original.startDate, days) : original.startDate);
      expect(changed?.laneId).toBe(original.laneId);
    }
    expect(after.stageMarkers).toEqual(productionDemo.stageMarkers);
    expect(productionDemo.project.revision).toBe(0);
    expect(after.project.revision).toBe(1);
  });
  it('grows the parent when a child is moved or resized outside it', () => {
    const after = applied(applyTimelineCommand(productionDemo, { type: 'resize', target: taskTarget, edge: 'start', date: dateOnly('2026-09-01') }));
    expect(after.processes[0]?.startDate).toBe('2026-09-01');
    expect(after.tasks[0]?.startDate).toBe('2026-09-01');
    const moved = applied(applyTimelineCommand(productionDemo, { type: 'move', target: taskTarget, days: -20 }));
    expect(moved.processes[0]?.startDate).toBe(addDays(task.startDate, -20));
  });
  it('does not shrink the parent or move siblings when a child is shortened', () => {
    const after = applied(applyTimelineCommand(productionDemo, { type: 'resize', target: taskTarget, edge: 'end', date: addDays(task.endDateExclusive, -5) }));
    expect(after.processes).toEqual(productionDemo.processes);
    expect(after.tasks.slice(1)).toEqual(productionDemo.tasks.slice(1));
  });
  it('rejects a process trim that cuts off children, without mutating the source', () => {
    const result = applyTimelineCommand(productionDemo, { type: 'resize', target: processTarget, edge: 'start', date: addDays(process.startDate, 10) });
    expect(result.ok).toBe(false);
    expect(productionDemo.processes[0]).toEqual(process);
    const after = applied(applyTimelineCommand(productionDemo, { type: 'resize', target: processTarget, edge: 'end', date: addDays(process.endDateExclusive, 10) }));
    expect(after.tasks).toEqual(productionDemo.tasks);
  });
  it('rejects collisions and zero-length intervals atomically', () => {
    expect(applyTimelineCommand(productionDemo, { type: 'resize', target: taskTarget, edge: 'end', date: addDays(task.endDateExclusive, 1) }).ok).toBe(false);
    expect(applyTimelineCommand(productionDemo, { type: 'resize', target: taskTarget, edge: 'end', date: task.startDate }).ok).toBe(false);
    expect(applyTimelineCommand(productionDemo, { type: 'move', target: taskTarget, days: 2 }).ok).toBe(false);
  });
  it('moves only a stage and keeps linked bands referencing that boundary', () => {
    const stage = productionDemo.stageMarkers[1];
    if (!stage) throw new Error('Missing stage');
    const after = applied(applyTimelineCommand(productionDemo, { type: 'stage', id: stage.id, date: addDays(stage.date, 7) }));
    expect(after.stageMarkers[1]?.date).toBe(addDays(stage.date, 7));
    expect(after.stageBands).toEqual(productionDemo.stageBands);
    expect(after.tasks).toEqual(productionDemo.tasks);
    expect(after.processes).toEqual(productionDemo.processes);
    expect(applyTimelineCommand(productionDemo, { type: 'stage', id: stage.id, date: dateOnly('2027-08-01') }).ok).toBe(false);
  });
  it('renames only the targeted bar and rejects blank names', () => {
    const after = applied(applyTimelineCommand(productionDemo, { type: 'rename', target: taskTarget, title: '  Эскизы героев  ' }));
    expect(after.tasks[0]?.title).toBe('Эскизы героев');
    expect(after.tasks.slice(1)).toEqual(productionDemo.tasks.slice(1));
    expect(after.processes).toEqual(productionDemo.processes);
    expect(applyTimelineCommand(productionDemo, { type: 'rename', target: taskTarget, title: '   ' }).ok).toBe(false);
  });
});
