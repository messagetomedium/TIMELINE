import { z } from "zod";
import type { ProjectDocument } from "../../domain";
import { snapshotSchema } from "../../domain/v2/model";

export const projectSummarySchema = z.strictObject({ project: snapshotSchema.shape.project });
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
const order = z.array(z.uuid()).refine((ids) => new Set(ids).size === ids.length);
const archiveEntry = z.strictObject({ kind: z.literal("archive"), id: z.uuid(), before: z.iso.datetime().nullable(), after: z.iso.datetime().nullable() });
const orderEntry = z.strictObject({ kind: z.literal("order"), before: order, after: order });
const entry = z.discriminatedUnion("kind", [archiveEntry, orderEntry]);
export const portfolioStateSchema = z.strictObject({ version: z.literal(1), revision: z.number().int().nonnegative(), order, undo: z.array(entry), redo: z.array(entry) });
export type PortfolioState = z.infer<typeof portfolioStateSchema>;
export type PortfolioCommand = { type: "ArchiveProject"; id: string; archived: boolean } | { type: "ReorderProjects"; order: string[] };
export const emptyPortfolio = (): PortfolioState => ({ version: 1, revision: 0, order: [], undo: [], redo: [] });

/** Lightweight adapter for the existing cards/calendar. Never reads or renders child work. */
export function summaryDocument({ project: p }: ProjectSummary): ProjectDocument {
  return {
    schemaVersion: 1,
    project: { id: p.id, name: p.name, description: p.description, anchorDate: p.anchorDate, startDate: p.startDate, endDateExclusive: p.endDateExclusive, sortIndex: p.sortIndex, createdAt: p.createdAt, updatedAt: p.updatedAt, revision: p.revision },
    stageMarkers: [], stageBands: [], lanes: [], processes: [], tasks: [], people: [], assignments: [],
    viewPreferences: { projectId: p.id, gridStep: "1w", zoomPxPerDay: 48, cameraX: 0, cameraY: 0, showWeekends: true, expandedProcessIds: [], expandedAssigneeGroupIds: [], showPeoplePanel: false },
  };
}
export function orderedProjects(projects: readonly ProjectSummary[], ids: readonly string[]) {
  const positions = new Map(ids.map((id, index) => [id, index]));
  return [...projects].sort((a, b) => (positions.get(a.project.id) ?? ids.length) - (positions.get(b.project.id) ?? ids.length));
}
