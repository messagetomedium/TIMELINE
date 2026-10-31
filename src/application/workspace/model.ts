import { z } from 'zod';
import { dateOnlySchema, gridStepSchema, projectDocumentSchema } from '../../domain';
import type { ProjectDocument } from '../../domain';
import type { ProjectRepository } from '../ProjectRepository';
import type { ViewPreferences, ProjectId } from '../../domain';

export const portfolioSchema = z.strictObject({
  camera: z.strictObject({ originDate: dateOnlySchema, pxPerDay: z.number().positive().max(48), panX: z.number() }).nullable(),
  step: gridStepSchema, showWeekends: z.boolean(),
});
export const workspacePreferencesSchema = z.strictObject({
  version: z.literal(1), inspectorCollapsed: z.boolean().optional(), mode: z.enum(['cards', 'timeline']), portfolio: portfolioSchema,
});
export type WorkspacePreferences = z.infer<typeof workspacePreferencesSchema>;
export type PortfolioPreferences = WorkspacePreferences['portfolio'];
export const defaultPreferences: WorkspacePreferences = { version: 1, mode: 'cards', portfolio: { camera: null, step: '1w', showWeekends: true } };

export function scopedIds(document: ProjectDocument): readonly string[] {
  return [document.project.id, ...document.stageMarkers.map((x) => x.id), ...document.stageBands.map((x) => x.id), ...document.lanes.map((x) => x.id), ...document.processes.map((x) => x.id), ...document.tasks.map((x) => x.id), ...document.assignments.map((x) => x.id)];
}
export const backupSchema = z.strictObject({
  format: z.literal('timeline-backup'), version: z.literal(1), exportedAt: z.iso.datetime({ offset: true }),
  documents: z.array(projectDocumentSchema), preferences: workspacePreferencesSchema,
}).superRefine((backup, context) => {
  const seen = new Set<string>();
  backup.documents.forEach((document, index) => {
    for (const id of scopedIds(document)) {
      if (seen.has(id)) context.addIssue({ code: 'custom', path: ['documents', index], message: 'Повторяющиеся ID проектов или вложенных элементов.' });
      seen.add(id);
    }
  });
});
export type Backup = z.infer<typeof backupSchema>;
export interface WorkspaceRepository extends ProjectRepository {
  initialize(seed: ProjectDocument): Promise<void>;
  all(): Promise<readonly ProjectDocument[]>;
  preferences(): Promise<WorkspacePreferences>;
  savePreferences(preferences: WorkspacePreferences): Promise<void>;
  views(): Promise<Readonly<Record<string, ViewPreferences>>>;
  saveView(id: ProjectId, view: ViewPreferences): Promise<void>;
  insertBatch(documents: readonly ProjectDocument[], preferences?: WorkspacePreferences): Promise<void>;
}
export class RevisionConflict extends Error {
  constructor() { super('Проект изменён или удалён в другой вкладке. Загружено актуальное состояние; повторите действие.'); this.name = 'RevisionConflict'; }
}
