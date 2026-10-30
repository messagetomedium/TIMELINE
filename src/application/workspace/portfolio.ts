import { addDays } from '../../domain';
import type { DateInterval, ProjectDocument } from '../../domain';

export function portfolioRange(document: ProjectDocument): DateInterval {
  const starts = [document.project.startDate, ...document.processes.map((x) => x.startDate), ...document.tasks.map((x) => x.startDate), ...document.stageMarkers.map((x) => x.date)];
  const ends = [document.project.endDateExclusive, ...document.processes.map((x) => x.endDateExclusive), ...document.tasks.map((x) => x.endDateExclusive), ...document.stageMarkers.map((x) => addDays(x.date, 1))];
  return { startDate: starts.reduce((a, b) => a < b ? a : b), endDateExclusive: ends.reduce((a, b) => a > b ? a : b) };
}
export function allProjectsRange(documents: readonly ProjectDocument[]): DateInterval | null {
  if (!documents.length) return null;
  const ranges = documents.map(portfolioRange);
  return { startDate: ranges.map((x) => x.startDate).reduce((a, b) => a < b ? a : b), endDateExclusive: ranges.map((x) => x.endDateExclusive).reduce((a, b) => a > b ? a : b) };
}
const palette = ['#8d80ca', '#5c9eaa', '#b99a5d', '#6e9b71', '#cb899d', '#718fae'];
export function projectColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length] ?? '#8d80ca';
}
