import type { ProjectDocument } from '../domain';

/** Read-only projections. UI receives data; no feature imports an adapter. */
export function orderedProcesses(document: ProjectDocument) {
  return [...document.processes].sort((a, b) => a.sortIndex - b.sortIndex || a.id.localeCompare(b.id));
}

export function orderedStageMarkers(document: ProjectDocument) {
  return [...document.stageMarkers].sort((a, b) => a.date.localeCompare(b.date) || a.sortIndex - b.sortIndex || a.id.localeCompare(b.id));
}
