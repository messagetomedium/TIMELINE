import type { DateInterval, ProcessId, ProjectDocument } from '../domain';

/** Include edited work outside explicit project bounds when fitting the scene. */
export function scheduleRange(document: ProjectDocument): DateInterval {
  const starts = [document.project.startDate, ...document.processes.map((item) => item.startDate), ...document.stageMarkers.map((item) => item.date)];
  const ends = [document.project.endDateExclusive, ...document.processes.map((item) => item.endDateExclusive), ...document.stageMarkers.map((item) => item.date)];
  return { startDate: starts.reduce((a, b) => a < b ? a : b), endDateExclusive: ends.reduce((a, b) => a > b ? a : b) };
}

export interface TimelineRow {
  readonly id: string;
  readonly kind: 'process' | 'task';
  readonly processId: ProcessId | null;
  readonly y: number;
}
export interface ProcessGroup {
  readonly processId: ProcessId;
  readonly y: number;
  readonly height: number;
}

/** Only explicit lane order determines Y. Shared process lanes grow by max child count. */
export function layoutTimeline(document: ProjectDocument, expanded: ReadonlySet<ProcessId>) {
  const rows: TimelineRow[] = [];
  const groups: ProcessGroup[] = [];
  let y = 18;
  const ordered = [...document.lanes].sort((a, b) => a.sortIndex - b.sortIndex || a.id.localeCompare(b.id));
  for (const lane of ordered.filter((item) => item.kind === 'process')) {
    rows.push({ id: lane.id, kind: 'process', processId: null, y });
    let maxChildren = 0;
    for (const process of document.processes.filter((item) => item.laneId === lane.id)) {
      const children = expanded.has(process.id) ? ordered.filter((item) => item.kind === 'task' && item.processId === process.id) : [];
      children.forEach((child, index) => rows.push({ id: child.id, kind: 'task', processId: process.id, y: y + 34 + index * 28 }));
      maxChildren = Math.max(maxChildren, children.length);
      if (children.length > 0) groups.push({ processId: process.id, y, height: 34 + children.length * 28 });
    }
    y += 34 + maxChildren * 28 + (maxChildren ? 10 : 0);
  }
  return { rows, groups, height: y + 24 };
}
