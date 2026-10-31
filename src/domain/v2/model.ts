import { personSchema, assignmentSchema } from "./peopleModel";
export { personSchema } from "./peopleModel";
import { z } from "zod";
import {
  projectSchema,
  processSchema,
  taskSchema,
  dateOnlySchema,
  viewPreferencesSchema,
  projectDocumentSchema,
} from "../schema";
import { projectIdSchema, laneIdSchema, processIdSchema } from "../ids";
import { containsInterval, addDays } from "../dates";

function overlapsPrevious(
  row: { startDate: string; endDateExclusive: string }[],
  i: number,
) {
  const a = row[i - 1],
    b = row[i];
  return (
    !!a &&
    !!b &&
    a.startDate < b.endDateExclusive &&
    b.startDate < a.endDateExclusive
  );
}
export const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const uuid = z.uuid();
const scope = { workspaceId: uuid, projectId: projectIdSchema };
const interval = {
  startDate: dateOnlySchema,
  endDateExclusive: dateOnlySchema,
};
const title = z.string().trim().min(1);
export const stageSchema = z.strictObject({
  ...scope,
  id: uuid,
  title,
  description: z.string(),
  ...interval,
  sortIndex: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
});
export const checkpointSchema = z.strictObject({
  ...scope,
  id: uuid,
  title,
  note: z.string(),
  revision: z.number().int().nonnegative(),
  timing: z.discriminatedUnion("anchor", [
    z.strictObject({ anchor: z.literal("free"), date: dateOnlySchema }),
    z.strictObject({ anchor: z.literal("project_end") }),
  ]),
});
export const resultSchema = z.strictObject({
  ...scope,
  id: uuid,
  stageId: uuid,
  processId: processIdSchema.nullable(),
  title: z.string(),
  description: z.string(),
  revision: z.number().int().nonnegative(),
});
export const resultPlacementSchema = z.strictObject({
  ...scope,
  resultId: uuid,
  isPlaced: z.boolean(),
  hiddenByUser: z.boolean(),
  layoutMode: z.enum(["auto", "manual"]),
  sortIndex: z.number().int().nonnegative(),
  manualY: z.number().nonnegative(),
  revision: z.number().int().nonnegative(),
});
export interface PeopleCatalog {
  list(workspaceId: string): Promise<readonly z.infer<typeof personSchema>[]>;
}
const laneSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...scope,
    id: laneIdSchema,
    kind: z.literal("process"),
    stageId: uuid,
    processId: z.null(),
    sortIndex: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ...scope,
    id: laneIdSchema,
    kind: z.literal("task"),
    processId: processIdSchema,
    sortIndex: z.number().int().nonnegative(),
  }),
]);
export const snapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    project: projectSchema.unwrap().extend({
      workspaceId: uuid,
      isScheduled: z.boolean(),
      archivedAt: z.iso.datetime().nullable(),
      visibility: z.literal("workspace"),
    }),
    stages: z.array(stageSchema).min(1),
    lanes: z.array(laneSchema),
    processes: z.array(
      processSchema.unwrap().extend({ workspaceId: uuid, stageId: uuid }),
    ),
    tasks: z.array(taskSchema.unwrap().extend(scope)),
    checkpoints: z.array(checkpointSchema),
    results: z.array(resultSchema),
    assignments: z.array(assignmentSchema).default([]),
    resultPlacements: z.array(resultPlacementSchema).default([]),
    viewPreferences: viewPreferencesSchema,
  })
  .superRefine((d, ctx) => {
    const fail = (message: string) => {
      ctx.addIssue({ code: "custom", message });
    };
    const ids = new Set<string>([d.project.id]);
    for (const collection of [
      d.stages,
      d.lanes,
      d.processes,
      d.tasks,
      d.checkpoints,
      d.results,
      d.assignments,
    ])
      for (const e of collection) {
        if (ids.has(e.id)) fail("Повторяющийся ID");
        ids.add(e.id);
        if (
          e.workspaceId !== d.project.workspaceId ||
          e.projectId !== d.project.id
        )
          fail("Несовпадающий workspace/project");
      }
    const stages = [...d.stages].sort((a, b) => a.sortIndex - b.sortIndex);
    for (const [i, s] of stages.entries()) {
      if (s.startDate >= s.endDateExclusive)
        fail("Этап должен длиться минимум день");
      if (
        (i === 0 && s.startDate !== d.project.startDate) ||
        (i === stages.length - 1 &&
          s.endDateExclusive !== d.project.endDateExclusive) ||
        (i > 0 && stages[i - 1]?.endDateExclusive !== s.startDate)
      )
        fail("Этапы должны последовательно покрывать проект");
      if (i > 0 && stages[i - 1]?.sortIndex === s.sortIndex)
        fail("Порядок этапов должен быть уникальным");
    }
    const sm = new Map(d.stages.map((s) => [s.id, s]));
    const pm = new Map(d.processes.map((p) => [p.id, p]));
    const lm = new Map(d.lanes.map((l) => [l.id, l]));
    for (const l of d.lanes)
      if (l.kind === "process" ? !sm.has(l.stageId) : !pm.has(l.processId))
        fail("Неизвестный владелец строки");
    for (const p of d.processes) {
      const s = sm.get(p.stageId),
        l = lm.get(p.laneId);
      if (
        !s ||
        !containsInterval(s, p) ||
        l?.kind !== "process" ||
        l.stageId !== p.stageId
      )
        fail("Процесс должен находиться в своём этапе и строке.");
    }
    for (const t of d.tasks) {
      const p = pm.get(t.processId),
        l = lm.get(t.laneId);
      if (
        !p ||
        !containsInterval(p, t) ||
        l?.kind !== "task" ||
        l.processId !== t.processId
      )
        fail("Задача должна находиться в своём процессе и строке");
    }
    const assignmentTargets = new Set<string>();
    for (const a of d.assignments) {
      const key = `${a.kind}:${a.targetId}`;
      if (
        assignmentTargets.has(key) ||
        !(a.kind === "process" ? d.processes : d.tasks).some(
          (w) => w.id === a.targetId,
        ) ||
        (!a.personId && !a.roleLabel.trim())
      )
        fail("Некорректное назначение исполнителя");
      assignmentTargets.add(key);
    }
    const linked = new Set<string>();
    for (const r of d.results) {
      if (
        !sm.has(r.stageId) ||
        (r.processId && pm.get(r.processId)?.stageId !== r.stageId)
      )
        fail("Неверная принадлежность результата");
      if (r.processId && linked.has(r.processId))
        fail("У процесса только один результат");
      if (r.processId) linked.add(r.processId);
    }
    const placements = new Set<string>();
    for (const p of d.resultPlacements) {
      if (
        placements.has(p.resultId) ||
        !d.results.some((r) => r.id === p.resultId) ||
        p.projectId !== d.project.id ||
        p.workspaceId !== d.project.workspaceId
      )
        fail("Некорректное размещение результата");
      placements.add(p.resultId);
      if (
        p.isPlaced &&
        (p.hiddenByUser ||
          !d.results.find((r) => r.id === p.resultId)?.title.trim())
      )
        fail("Пустой или скрытый результат нельзя разместить");
    }
    for (const list of [d.processes, d.tasks]) {
      const byLane = new Map<string, (typeof list)[number][]>();
      for (const e of list) {
        const row = byLane.get(e.laneId) ?? [];
        row.push(e);
        byLane.set(e.laneId, row);
      }
      for (const row of byLane.values()) {
        row.sort((a, b) => a.startDate.localeCompare(b.startDate));
        for (let i = 1; i < row.length; i++)
          if (overlapsPrevious(row, i))
            fail("На этой дорожке уже есть работа в выбранные даты.");
      }
    }
    if (
      d.viewPreferences.projectId !== d.project.id ||
      d.viewPreferences.expandedProcessIds.some((id) => !pm.has(id)) ||
      d.viewPreferences.expandedAssigneeGroupIds.length
    )
      fail("Некорректные настройки проекта");
  });
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Result = z.infer<typeof resultSchema>;
export type ResultPlacement = z.infer<typeof resultPlacementSchema>;
export const entityId = (e: { id: string } | { resultId: string }) =>
  "id" in e ? e.id : e.resultId;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export const checkpointDate = (d: Snapshot, c: Checkpoint) =>
  c.timing.anchor === "free"
    ? c.timing.date
    : addDays(d.project.endDateExclusive, -1);

/** Rendering projection only. V1 is never persisted or used as the V2 source of truth. */
export function displayDocument(d: Snapshot) {
  const project = {
    id: d.project.id,
    name: d.project.name,
    description: d.project.description,
    anchorDate: d.project.anchorDate,
    startDate: d.project.startDate,
    endDateExclusive: d.project.endDateExclusive,
    sortIndex: d.project.sortIndex,
    createdAt: d.project.createdAt,
    updatedAt: d.project.updatedAt,
    revision: d.project.revision,
  };
  const ordered = [...d.stages].sort((a, b) => a.sortIndex - b.sortIndex);
  return projectDocumentSchema.parse({
    schemaVersion: 1,
    project,
    stageMarkers: ordered.map((s) => ({
      id: s.id,
      projectId: project.id,
      title: s.title,
      date: s.startDate,
      sortIndex: s.sortIndex,
    })),
    stageBands: [],
    lanes: d.lanes.map((l) => ({
      id: l.id,
      projectId: l.projectId,
      kind: l.kind,
      processId: l.processId,
      sortIndex: l.sortIndex,
    })),
    processes: d.processes.map((p) => ({
      id: p.id,
      projectId: p.projectId,
      laneId: p.laneId,
      title: p.title,
      startDate: p.startDate,
      endDateExclusive: p.endDateExclusive,
      color: p.color,
      status: p.status,
      details: p.details,
      sortIndex: p.sortIndex,
      revision: p.revision,
    })),
    tasks: d.tasks.map((t) => ({
      id: t.id,
      processId: t.processId,
      laneId: t.laneId,
      title: t.title,
      startDate: t.startDate,
      endDateExclusive: t.endDateExclusive,
      status: t.status,
      details: t.details,
      sortIndex: t.sortIndex,
      revision: t.revision,
    })),
    people: [],
    assignments: [],
    viewPreferences: d.viewPreferences,
  });
}

/** Remove dangling expansions while retaining independent camera/view settings. */
export function normalizeView(
  document: Snapshot,
  view: Snapshot["viewPreferences"],
) {
  if (view.projectId !== document.project.id)
    throw Error("Вид принадлежит другому проекту");
  const ids = new Set(document.processes.map((p) => p.id));
  return viewPreferencesSchema.parse({
    ...view,
    expandedProcessIds: view.expandedProcessIds.filter((id) => ids.has(id)),
  });
}
